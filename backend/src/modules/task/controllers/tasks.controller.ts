import {
  Body,
  Controller,
  Get,
  Header,
  MessageEvent,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { CurrentUser } from '../../../shared/auth/current-user.decorator';
import type { RequestUser } from '../../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/auth/jwt-auth.guard';
import { Permissions } from '../../../shared/auth/permissions.decorator';
import { PermissionsGuard } from '../../../shared/auth/permissions.guard';
import { Roles } from '../../../shared/auth/roles.decorator';
import { RolesGuard } from '../../../shared/auth/roles.guard';
import { TenantAccessGuard } from '../../../shared/auth/tenant-access.guard';
import { AddTaskCommentDto } from '../dto/add-task-comment.dto';
import { AssignTaskDto } from '../dto/assign-task.dto';
import { CreateTaskDto } from '../dto/create-task.dto';
import { ListOverdueTasksDto } from '../dto/list-overdue-tasks.dto';
import { ListTaskCommentsDto } from '../dto/list-task-comments.dto';
import { ListTasksDto } from '../dto/list-tasks.dto';
import { TaskBoardDto } from '../dto/task-board.dto';
import { TransitionTaskStatusDto } from '../dto/transition-task-status.dto';
import { UpdateTaskDto } from '../dto/update-task.dto';
import { UpdateTaskPositionDto } from '../dto/update-task-position.dto';
import { TasksService } from '../services/tasks.service';
import { RealtimeEventsService } from '../../../shared/events/realtime-events.service';

@ApiTags('tasks')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, TenantAccessGuard, RolesGuard, PermissionsGuard)
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly realtimeEvents: RealtimeEventsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a task' })
  @Roles('incident_commander', 'shift_lead', 'tenant_admin', 'platform_admin')
  @Permissions('task.create')
  async create(
    @CurrentUser() actor: RequestUser,
    @Body() dto: CreateTaskDto,
  ) {
    return { data: await this.tasks.create(actor, dto) };
  }

  @Get()
  @ApiOperation({ summary: 'List tasks visible to the current user' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('task.read')
  async findAll(
    @CurrentUser() actor: RequestUser,
    @Query() query: ListTasksDto,
  ) {
    return { data: await this.tasks.findAll(actor, query) };
  }

  @Get('board')
  @ApiOperation({ summary: 'Get a task board grouped by status' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('task.read')
  async board(
    @CurrentUser() actor: RequestUser,
    @Query() query: TaskBoardDto,
  ) {
    return { data: await this.tasks.getBoard(actor, query) };
  }

  @Get('my')
  @ApiOperation({ summary: 'List tasks assigned to the current user' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('task.read')
  async my(
    @CurrentUser() actor: RequestUser,
    @Query() query: ListTasksDto,
  ) {
    return { data: await this.tasks.getMyTasks(actor, query) };
  }

  @Get('overdue')
  @ApiOperation({ summary: 'List overdue tasks' })
  @Roles('shift_lead', 'tenant_admin', 'platform_admin')
  @Permissions('task.read')
  async overdue(
    @CurrentUser() actor: RequestUser,
    @Query() query: ListOverdueTasksDto,
  ) {
    return { data: await this.tasks.getOverdueTasks(actor, query) };
  }

  @Sse('stream')
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('Connection', 'keep-alive')
  @Header('X-Accel-Buffering', 'no')
  @ApiOperation({ summary: 'Stream task workspace updates via SSE' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('task.read')
  stream(
    @CurrentUser() actor: RequestUser,
    @Query('incidentId') incidentId?: string,
    @Query('taskId') taskId?: string,
  ): Observable<MessageEvent> {
    return this.realtimeEvents.stream({
      tenantId: actor.tenantId,
      incidentId: incidentId ?? null,
      taskId: taskId ?? null,
      eventPrefix: 'task.',
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a task by ID' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('task.read')
  async findOne(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.tasks.findOne(actor, id) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update mutable task fields' })
  @Roles(
    'shift_lead',
    'incident_commander',
    'field_responder',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('task.update')
  async update(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return { data: await this.tasks.update(actor, id, dto) };
  }

  @Patch(':id/position')
  @ApiOperation({ summary: 'Reorder a task within its current status lane' })
  @Roles(
    'shift_lead',
    'incident_commander',
    'field_responder',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('task.update')
  async updatePosition(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskPositionDto,
  ) {
    return { data: await this.tasks.updatePosition(actor, id, dto) };
  }

  @Get(':id/transitions/available')
  @ApiOperation({ summary: 'List task transitions currently available to the caller' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('task.read')
  async availableTransitions(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.tasks.getAvailableTransitions(actor, id) };
  }

  @Get(':id/comments')
  @ApiOperation({ summary: 'List task comments' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('task.read')
  async listComments(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListTaskCommentsDto,
  ) {
    return { data: await this.tasks.listComments(actor, id, query) };
  }

  @Post(':id/comments')
  @ApiOperation({ summary: 'Add a comment to a task' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('task.comment')
  async addComment(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddTaskCommentDto,
  ) {
    return { data: await this.tasks.addComment(actor, id, dto) };
  }

  @Post(':id/assign')
  @ApiOperation({ summary: 'Assign or reassign a task' })
  @Roles('incident_commander', 'shift_lead', 'tenant_admin', 'platform_admin')
  @Permissions('task.assign')
  async assign(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTaskDto,
  ) {
    return { data: await this.tasks.assign(actor, id, dto) };
  }

  @Post(':id/transitions')
  @ApiOperation({ summary: 'Execute a task status transition' })
  @Roles(
    'shift_lead',
    'incident_commander',
    'field_responder',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('task.update.status')
  async transition(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionTaskStatusDto,
  ) {
    return { data: await this.tasks.transition(actor, id, dto) };
  }
}
