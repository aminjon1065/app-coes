import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DatabaseContextService } from '../../../shared/database/database-context.service';
import { User } from '../../iam/entities/user.entity';
import { IncidentParticipant } from '../../incident/entities/incident-participant.entity';
import { Incident } from '../../incident/entities/incident.entity';
import { ChannelMember } from '../entities/channel-member.entity';
import { Channel } from '../entities/channel.entity';
import { Message } from '../entities/message.entity';
import { ChannelService } from './channel.service';

const actor = {
  id: 'user-1',
  tenantId: 'tenant-1',
  roles: ['incident_commander'],
  clearance: 3,
  sessionId: 'session-1',
};

function createRepo() {
  return {
    createQueryBuilder: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    count: jest.fn(),
    create: jest.fn((value) => value),
    remove: jest.fn(),
    update: jest.fn(),
  };
}

describe('ChannelService', () => {
  let service: ChannelService;
  const channelRepo = createRepo();
  const channelMemberRepo = createRepo();
  const messageRepo = createRepo();
  const userRepo = createRepo();
  const incidentRepo = createRepo();
  const participantRepo = createRepo();

  beforeEach(async () => {
    jest.resetAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelService,
        DatabaseContextService,
        {
          provide: DataSource,
          useValue: {},
        },
        { provide: getRepositoryToken(Channel), useValue: channelRepo },
        { provide: getRepositoryToken(ChannelMember), useValue: channelMemberRepo },
        { provide: getRepositoryToken(Message), useValue: messageRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Incident), useValue: incidentRepo },
        {
          provide: getRepositoryToken(IncidentParticipant),
          useValue: participantRepo,
        },
      ],
    }).compile();

    service = moduleRef.get(ChannelService);
    jest
      .spyOn(moduleRef.get(DatabaseContextService), 'getRepository')
      .mockImplementation((_dataSource, entity) => {
        switch (entity) {
          case Channel:
            return channelRepo as any;
          case ChannelMember:
            return channelMemberRepo as any;
          case Message:
            return messageRepo as any;
          case User:
            return userRepo as any;
          case Incident:
            return incidentRepo as any;
          case IncidentParticipant:
            return participantRepo as any;
          default:
            throw new Error(`Unexpected entity: ${String(entity)}`);
        }
      });
  });

  it('creates a direct channel once for the same pair', async () => {
    userRepo.find.mockResolvedValue([
      { id: 'user-1', tenantId: actor.tenantId, status: 'active' },
      { id: 'user-2', tenantId: actor.tenantId, status: 'active' },
    ]);
    channelRepo.find.mockResolvedValue([]);
    channelRepo.create.mockImplementation((value) => ({ id: 'channel-1', ...value }));
    channelRepo.save.mockResolvedValue({
      id: 'channel-1',
      tenantId: actor.tenantId,
      type: 'DIRECT',
      createdBy: actor.id,
      incidentId: null,
      archivedAt: null,
    });
    channelMemberRepo.save.mockResolvedValue(undefined);
    channelMemberRepo.count.mockResolvedValue(2);
    channelMemberRepo.findOne.mockResolvedValue({
      channelId: 'channel-1',
      userId: actor.id,
      lastReadAt: new Date(),
    });
    messageRepo.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    });
    messageRepo.findOne.mockResolvedValue(null);

    const created = await service.create(actor as any, {
      type: 'DIRECT',
      memberIds: ['user-2'],
    });

    expect(created.type).toBe('DIRECT');
    expect(channelRepo.save).toHaveBeenCalledTimes(1);
  });

  it('syncs incident room members to current participants', async () => {
    channelRepo.findOne.mockResolvedValue({
      id: 'channel-7',
      tenantId: actor.tenantId,
      incidentId: 'incident-1',
      type: 'INCIDENT_ROOM',
      createdBy: actor.id,
      archivedAt: null,
    });
    participantRepo.find.mockResolvedValue([
      { userId: 'user-2' },
      { userId: 'user-3' },
    ]);
    channelMemberRepo.find
      .mockResolvedValueOnce([{ userId: actor.id }, { userId: 'user-2' }])
      .mockResolvedValueOnce([]);
    userRepo.find.mockResolvedValue([
      { id: 'user-3', tenantId: actor.tenantId, status: 'active' },
    ]);
    channelMemberRepo.save.mockResolvedValue(undefined);
    channelMemberRepo.remove.mockResolvedValue(undefined);
    channelMemberRepo.count.mockResolvedValue(3);
    channelMemberRepo.findOne.mockResolvedValue({
      channelId: 'channel-7',
      userId: actor.id,
      lastReadAt: new Date(),
    });
    messageRepo.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    });
    messageRepo.findOne.mockResolvedValue(null);

    await service.syncIncidentParticipants(actor.tenantId, 'incident-1', actor.id);

    expect(channelMemberRepo.save).toHaveBeenCalled();
  });
});
