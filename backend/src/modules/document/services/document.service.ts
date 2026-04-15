import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { RequestUser } from '../../../shared/auth/current-user.decorator';
import { DatabaseContextService } from '../../../shared/database/database-context.service';
import { MinioService } from '../../file/services/minio.service';
import { Role } from '../../iam/entities/role.entity';
import { UserRole } from '../../iam/entities/user-role.entity';
import { User } from '../../iam/entities/user.entity';
import { IncidentParticipant } from '../../incident/entities/incident-participant.entity';
import { Incident } from '../../incident/entities/incident.entity';
import { CreateDocumentDto } from '../dto/create-document.dto';
import { ListDocumentsDto } from '../dto/list-documents.dto';
import { DocumentApproval } from '../entities/document-approval.entity';
import {
  DocumentEntity,
  DocumentLifecycleState,
} from '../entities/document.entity';
import { DocumentVersion } from '../entities/document-version.entity';
import { PdfRenderService } from './pdf-render.service';

type DocumentDetail = DocumentEntity & {
  versions: DocumentVersion[];
  approvals: DocumentApproval[];
};

@Injectable()
export class DocumentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly databaseContext: DatabaseContextService,
    private readonly minio: MinioService,
    private readonly config: ConfigService,
    private readonly renderer: PdfRenderService,
    private readonly events: EventEmitter2,
  ) {}

  private get documents(): Repository<DocumentEntity> {
    return this.databaseContext.getRepository(this.dataSource, DocumentEntity);
  }

  private get versions(): Repository<DocumentVersion> {
    return this.databaseContext.getRepository(this.dataSource, DocumentVersion);
  }

  private get approvals(): Repository<DocumentApproval> {
    return this.databaseContext.getRepository(
      this.dataSource,
      DocumentApproval,
    );
  }

  private get incidents(): Repository<Incident> {
    return this.databaseContext.getRepository(this.dataSource, Incident);
  }

  private get participants(): Repository<IncidentParticipant> {
    return this.databaseContext.getRepository(
      this.dataSource,
      IncidentParticipant,
    );
  }

  private get users(): Repository<User> {
    return this.databaseContext.getRepository(this.dataSource, User);
  }

  private get userRoles(): Repository<UserRole> {
    return this.databaseContext.getRepository(this.dataSource, UserRole);
  }

  async create(
    actor: RequestUser,
    dto: CreateDocumentDto,
  ): Promise<DocumentDetail> {
    const incident = await this.loadIncident(
      actor,
      dto.incidentId ?? null,
      true,
    );
    const classification = dto.classification ?? incident?.classification ?? 1;

    const document = await this.documents.save(
      this.documents.create({
        tenantId: actor.tenantId,
        incidentId: dto.incidentId ?? null,
        title: dto.title.trim(),
        templateCode: dto.templateCode.trim(),
        classification,
        lifecycleState: 'DRAFT',
        currentVersionId: null,
        createdBy: actor.id,
        metadata: {
          ...(dto.metadata ?? {}),
          templateVars: dto.templateVars ?? {},
        },
      }),
    );

    this.events.emit('document.render_requested', {
      tenantId: actor.tenantId,
      actorId: actor.id,
      documentId: document.id,
      incidentId: document.incidentId,
      templateCode: document.templateCode,
    });

    const version = await this.renderAndStoreVersion(
      document,
      actor.id,
      dto.templateVars ?? {},
    );
    document.currentVersionId = version.id;
    await this.documents.save(document);

    this.events.emit('document.version_ready', {
      tenantId: actor.tenantId,
      actorId: actor.id,
      documentId: document.id,
      versionId: version.id,
      incidentId: document.incidentId,
    });

    this.events.emit('document.created', {
      tenantId: actor.tenantId,
      actorId: actor.id,
      documentId: document.id,
      incidentId: document.incidentId,
      templateCode: document.templateCode,
    });

    return this.findOne(actor, document.id);
  }

  async list(
    actor: RequestUser,
    query: ListDocumentsDto,
  ): Promise<DocumentEntity[]> {
    const qb = this.baseVisibleQuery(actor);
    if (query.state) {
      qb.andWhere('document.lifecycle_state = :state', { state: query.state });
    }
    if (query.incidentId) {
      qb.andWhere('document.incident_id = :incidentId', {
        incidentId: query.incidentId,
      });
    }
    if (query.templateCode) {
      qb.andWhere('document.template_code = :templateCode', {
        templateCode: query.templateCode,
      });
    }
    return qb.orderBy('document.updated_at', 'DESC').getMany();
  }

  async findOne(actor: RequestUser, id: string): Promise<DocumentDetail> {
    const document = await this.baseVisibleQuery(actor)
      .andWhere('document.id = :id', { id })
      .getOne();
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    const versions = await this.versions.find({
      where: { documentId: id },
      order: { versionNumber: 'DESC', createdAt: 'DESC' },
    });
    const approvals = await this.approvals.find({
      where: { documentId: id },
      order: { createdAt: 'ASC' },
    });
    return Object.assign(document, { versions, approvals });
  }

  async listVersions(
    actor: RequestUser,
    id: string,
  ): Promise<DocumentVersion[]> {
    await this.findOne(actor, id);
    return this.versions.find({
      where: { documentId: id },
      order: { versionNumber: 'DESC', createdAt: 'DESC' },
    });
  }

  async getVersionUrl(
    actor: RequestUser,
    documentId: string,
    versionId: string,
  ): Promise<string> {
    await this.findOne(actor, documentId);
    const version = await this.versions.findOne({
      where: { id: versionId, documentId },
    });
    if (!version) {
      throw new NotFoundException('Document version not found');
    }
    return this.minio.presignedGetUrl(
      version.storageBucket,
      version.storageKey,
      3600,
    );
  }

  async submitReview(
    actor: RequestUser,
    documentId: string,
  ): Promise<DocumentDetail> {
    const document = await this.loadForMutation(actor, documentId);
    if (document.lifecycleState !== 'DRAFT') {
      throw new ConflictException('DOCUMENT_INVALID_STATE');
    }
    if (!this.canManageDocument(actor, document)) {
      throw new ForbiddenException('DOCUMENT_REVIEW_FORBIDDEN');
    }

    document.lifecycleState = 'REVIEW';
    await this.documents.save(document);
    await this.ensureApprovalRecords(document, actor);

    this.events.emit('document.review_submitted', {
      tenantId: document.tenantId,
      actorId: actor.id,
      documentId: document.id,
      incidentId: document.incidentId,
      versionId: document.currentVersionId,
    });

    return this.findOne(actor, documentId);
  }

  async approve(
    actor: RequestUser,
    documentId: string,
    comment?: string,
  ): Promise<DocumentDetail> {
    const document = await this.loadForMutation(actor, documentId);
    if (document.lifecycleState !== 'REVIEW') {
      throw new ConflictException('DOCUMENT_INVALID_STATE');
    }
    const level = this.resolveApprovalLevel(actor);
    if (!level) {
      throw new ForbiddenException('DOCUMENT_APPROVE_FORBIDDEN');
    }

    const approval = await this.findOrCreateApproval(document, actor.id);
    approval.status = 'APPROVED';
    approval.comment = comment?.trim() ?? null;
    approval.signedAt = new Date();
    await this.approvals.save(approval);

    const pending = await this.approvals.count({
      where: {
        documentId,
        versionId: document.currentVersionId ?? undefined,
        status: In(['PENDING', 'REJECTED']) as never,
      } as never,
    });
    if (pending === 0) {
      document.lifecycleState = 'APPROVED';
      await this.documents.save(document);
    }

    this.events.emit('document.approved', {
      tenantId: document.tenantId,
      actorId: actor.id,
      documentId: document.id,
      incidentId: document.incidentId,
      level,
      versionId: document.currentVersionId,
    });

    return this.findOne(actor, documentId);
  }

  async reject(
    actor: RequestUser,
    documentId: string,
    comment?: string,
  ): Promise<DocumentDetail> {
    const document = await this.loadForMutation(actor, documentId);
    if (document.lifecycleState !== 'REVIEW') {
      throw new ConflictException('DOCUMENT_INVALID_STATE');
    }
    if (!this.resolveApprovalLevel(actor)) {
      throw new ForbiddenException('DOCUMENT_APPROVE_FORBIDDEN');
    }

    const approval = await this.findOrCreateApproval(document, actor.id);
    approval.status = 'REJECTED';
    approval.comment = comment?.trim() ?? null;
    approval.signedAt = new Date();
    await this.approvals.save(approval);

    document.lifecycleState = 'DRAFT';
    document.metadata = {
      ...document.metadata,
      lastRejectionComment: comment?.trim() ?? null,
      lastRejectedBy: actor.id,
    };
    await this.documents.save(document);

    this.events.emit('document.rejected', {
      tenantId: document.tenantId,
      actorId: actor.id,
      documentId: document.id,
      incidentId: document.incidentId,
      versionId: document.currentVersionId,
    });

    return this.findOne(actor, documentId);
  }

  async publish(
    actor: RequestUser,
    documentId: string,
  ): Promise<DocumentDetail> {
    const document = await this.loadForMutation(actor, documentId);
    if (document.lifecycleState !== 'APPROVED') {
      throw new ConflictException('DOCUMENT_INVALID_STATE');
    }
    if (!this.canPublish(actor, document)) {
      throw new ForbiddenException('DOCUMENT_PUBLISH_FORBIDDEN');
    }

    const pending = await this.approvals.count({
      where: {
        documentId,
        versionId: document.currentVersionId ?? undefined,
        status: In(['PENDING', 'REJECTED']) as never,
      } as never,
    });
    if (pending > 0) {
      throw new UnprocessableEntityException('DOCUMENT_APPROVALS_PENDING');
    }

    document.lifecycleState = 'PUBLISHED';
    await this.documents.save(document);
    this.events.emit('document.published', {
      tenantId: document.tenantId,
      actorId: actor.id,
      documentId: document.id,
      incidentId: document.incidentId,
      versionId: document.currentVersionId,
    });
    return this.findOne(actor, documentId);
  }

  async revoke(
    actor: RequestUser,
    documentId: string,
    comment?: string,
  ): Promise<DocumentDetail> {
    const document = await this.loadForMutation(actor, documentId);
    if (
      !['PUBLISHED', 'APPROVED', 'REVIEW', 'DRAFT'].includes(
        document.lifecycleState,
      )
    ) {
      throw new ConflictException('DOCUMENT_INVALID_STATE');
    }
    if (!this.canPublish(actor, document)) {
      throw new ForbiddenException('DOCUMENT_REVOKE_FORBIDDEN');
    }

    const version = await this.renderAndStoreVersion(
      document,
      actor.id,
      {
        title: document.title,
        revocationReason: comment?.trim() ?? 'Revoked',
        revokedAt: new Date().toISOString(),
        documentId: document.id,
      },
      'revocation',
    );
    document.currentVersionId = version.id;
    document.lifecycleState = 'REVOKED';
    document.metadata = {
      ...document.metadata,
      revocationComment: comment?.trim() ?? null,
    };
    await this.documents.save(document);

    this.events.emit('document.revoked', {
      tenantId: document.tenantId,
      actorId: actor.id,
      documentId: document.id,
      incidentId: document.incidentId,
      versionId: version.id,
    });

    return this.findOne(actor, documentId);
  }

  private async loadForMutation(
    actor: RequestUser,
    id: string,
  ): Promise<DocumentEntity> {
    const document = await this.findOne(actor, id);
    return document;
  }

  private baseVisibleQuery(actor: RequestUser) {
    return this.documents
      .createQueryBuilder('document')
      .leftJoinAndSelect('document.currentVersion', 'currentVersion')
      .leftJoinAndSelect('document.incident', 'incident')
      .leftJoinAndSelect('document.creator', 'creator')
      .where('document.tenant_id = :tenantId', { tenantId: actor.tenantId })
      .andWhere('document.classification <= :clearance', {
        clearance: actor.clearance,
      });
  }

  private async renderAndStoreVersion(
    document: DocumentEntity,
    actorId: string,
    templateVars: Record<string, unknown>,
    variant: 'normal' | 'revocation' = 'normal',
  ): Promise<DocumentVersion> {
    const content = {
      title: document.title,
      documentId: document.id,
      incidentId: document.incidentId,
      generatedAt: new Date().toISOString(),
      ...templateVars,
    };
    const templateCode =
      variant === 'revocation' ? 'post-incident-report' : document.templateCode;
    const pdf = await this.renderer.renderFromTemplate(templateCode, content);
    const checksum = createHash('sha256').update(pdf).digest('hex');
    const bucket = this.getBucket();
    const versionNumber =
      ((await this.versions.count({ where: { documentId: document.id } })) ||
        0) + 1;
    const key = `${document.tenantId}/documents/${document.id}/v${versionNumber}-${randomUUID()}.pdf`;

    await this.minio.putObject(bucket, key, pdf, pdf.length, 'application/pdf');
    return this.versions.save(
      this.versions.create({
        documentId: document.id,
        versionNumber,
        storageBucket: bucket,
        storageKey: key,
        checksumSha256: checksum,
        sizeBytes: String(pdf.length),
        renderedAt: new Date(),
        createdBy: actorId,
      }),
    );
  }

  private async loadIncident(
    actor: RequestUser,
    incidentId: string | null,
    requireManage: boolean,
  ) {
    if (!incidentId) return null;
    const incident = await this.incidents.findOne({
      where: { id: incidentId, tenantId: actor.tenantId },
      select: {
        id: true,
        classification: true,
        commanderId: true,
        createdBy: true,
        status: true,
      },
    });
    if (!incident || incident.classification > actor.clearance) {
      throw new NotFoundException('Incident not found');
    }
    if (requireManage && !this.canManageIncident(actor, incident)) {
      throw new ForbiddenException('DOCUMENT_CREATE_FORBIDDEN');
    }
    return incident;
  }

  private canManageIncident(
    actor: RequestUser,
    incident: Pick<Incident, 'commanderId' | 'createdBy'>,
  ) {
    return (
      incident.commanderId === actor.id ||
      incident.createdBy === actor.id ||
      actor.roles.includes('platform_admin') ||
      actor.roles.includes('tenant_admin') ||
      actor.roles.includes('incident_commander')
    );
  }

  private canManageDocument(actor: RequestUser, document: DocumentEntity) {
    return (
      document.createdBy === actor.id ||
      actor.roles.includes('platform_admin') ||
      actor.roles.includes('tenant_admin') ||
      actor.roles.includes('incident_commander')
    );
  }

  private canPublish(actor: RequestUser, document: DocumentEntity) {
    return (
      actor.roles.includes('platform_admin') ||
      actor.roles.includes('tenant_admin') ||
      actor.roles.includes('incident_commander') ||
      document.createdBy === actor.id
    );
  }

  private resolveApprovalLevel(actor: RequestUser): 'level1' | 'level2' | null {
    if (
      actor.roles.includes('platform_admin') ||
      actor.roles.includes('tenant_admin') ||
      actor.roles.includes('incident_commander')
    ) {
      return 'level2';
    }
    if (actor.roles.includes('shift_lead')) {
      return 'level1';
    }
    return null;
  }

  private async ensureApprovalRecords(
    document: DocumentEntity,
    actor: RequestUser,
  ): Promise<void> {
    const approverIds = await this.resolveApproverIds(document, actor);
    for (const approverId of approverIds) {
      const existing = await this.approvals.findOne({
        where: {
          documentId: document.id,
          versionId: document.currentVersionId ?? undefined,
          approverId,
        } as never,
      });
      if (!existing && document.currentVersionId) {
        await this.approvals.save(
          this.approvals.create({
            documentId: document.id,
            versionId: document.currentVersionId,
            approverId,
            status: 'PENDING',
            comment: null,
            signedAt: null,
          }),
        );
      }
    }
  }

  private async resolveApproverIds(
    document: DocumentEntity,
    actor: RequestUser,
  ): Promise<string[]> {
    const approverIds = new Set<string>();
    if (document.incidentId) {
      const incident = await this.incidents.findOne({
        where: { id: document.incidentId, tenantId: document.tenantId },
        select: { commanderId: true },
      });
      if (incident?.commanderId) approverIds.add(incident.commanderId);
    }

    const shiftLeadIds = await this.userRoles
      .createQueryBuilder('userRole')
      .innerJoin(Role, 'role', 'role.id = userRole.role_id')
      .where('role.code = :roleCode', { roleCode: 'shift_lead' })
      .andWhere('userRole.user_id IS NOT NULL')
      .select('userRole.user_id', 'userId')
      .getRawMany<{ userId: string }>();
    shiftLeadIds.forEach((row) => approverIds.add(row.userId));

    if (approverIds.size === 0) {
      approverIds.add(actor.id);
    }
    return [...approverIds];
  }

  private async findOrCreateApproval(
    document: DocumentEntity,
    approverId: string,
  ) {
    let approval = await this.approvals.findOne({
      where: {
        documentId: document.id,
        versionId: document.currentVersionId ?? undefined,
        approverId,
      } as never,
    });
    if (!approval) {
      if (!document.currentVersionId) {
        throw new UnprocessableEntityException('DOCUMENT_VERSION_REQUIRED');
      }
      approval = await this.approvals.save(
        this.approvals.create({
          documentId: document.id,
          versionId: document.currentVersionId,
          approverId,
          status: 'PENDING',
          comment: null,
          signedAt: null,
        }),
      );
    }
    return approval;
  }

  private getBucket() {
    return this.config.get<string>(
      'MINIO_DOCUMENTS_BUCKET',
      'coescd-dev-documents',
    );
  }
}
