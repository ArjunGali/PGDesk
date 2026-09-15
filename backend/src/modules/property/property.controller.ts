import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/permissions';
import { AuditService } from '../audit/audit.service';
import {
  CreateBranchDto,
  CreateFloorDto,
  CreateFloorTypeDto,
  CreateRoomDto,
  UpdateBranchDto,
  UpdateFloorDto,
  UpdateRoomDto,
  VacancyQueryDto,
} from './dto';
import { PropertyService } from './property.service';

@Controller()
export class PropertyController {
  constructor(
    private readonly property: PropertyService,
    private readonly audit: AuditService,
  ) {}

  // --- Home --------------------------------------------------------------

  @Get('home/summary')
  @RequirePermissions(PERMISSIONS.BRANCH_VIEW)
  homeSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query('upcomingDays') upcomingDays?: string,
  ) {
    return this.property.branchSummaries(
      new Date(),
      upcomingDays ? Number(upcomingDays) : 30,
      user.branchIds,
    );
  }

  // --- Branches ----------------------------------------------------------

  @Get('branches')
  @RequirePermissions(PERMISSIONS.BRANCH_VIEW)
  listBranches(
    @CurrentUser() user: AuthenticatedUser,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.property.listBranches(includeArchived === 'true', user.branchIds);
  }

  @Get('branches/:id')
  @RequirePermissions(PERMISSIONS.BRANCH_VIEW)
  getBranch(@Param('id') id: string) {
    return this.property.getBranch(id);
  }

  @Get('branches/:id/tree')
  @RequirePermissions(PERMISSIONS.BRANCH_VIEW)
  branchTree(@Param('id') id: string, @Query('asOf') asOf?: string) {
    return this.property.branchTree(id, asOf ? new Date(asOf) : new Date());
  }

  @Post('branches')
  @RequirePermissions(PERMISSIONS.BRANCH_MANAGE)
  async createBranch(
    @Body() dto: CreateBranchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const branch = await this.property.createBranch(dto);
    await this.audit.record({
      actorId: user.id,
      action: 'branch.create',
      entityType: 'Branch',
      entityId: branch.id,
      after: branch,
    });
    return branch;
  }

  @Patch('branches/:id')
  @RequirePermissions(PERMISSIONS.BRANCH_MANAGE)
  async updateBranch(
    @Param('id') id: string,
    @Body() dto: UpdateBranchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const branch = await this.property.updateBranch(id, dto);
    await this.audit.record({
      actorId: user.id,
      action: 'branch.update',
      entityType: 'Branch',
      entityId: id,
      after: dto,
    });
    return branch;
  }

  // --- Floor types -------------------------------------------------------

  @Get('floor-types')
  @RequirePermissions(PERMISSIONS.BRANCH_VIEW)
  listFloorTypes() {
    return this.property.listFloorTypes();
  }

  @Post('floor-types')
  @RequirePermissions(PERMISSIONS.BRANCH_MANAGE)
  createFloorType(@Body() dto: CreateFloorTypeDto) {
    return this.property.createFloorType(dto);
  }

  // --- Floors ------------------------------------------------------------

  @Get('branches/:id/floors')
  @RequirePermissions(PERMISSIONS.BRANCH_VIEW)
  listFloors(@Param('id') id: string) {
    return this.property.listFloors(id);
  }

  @Post('branches/:id/floors')
  @RequirePermissions(PERMISSIONS.BRANCH_MANAGE)
  async createFloor(
    @Param('id') id: string,
    @Body() dto: CreateFloorDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const floor = await this.property.createFloor(id, dto);
    await this.audit.record({
      actorId: user.id,
      action: 'floor.create',
      entityType: 'Floor',
      entityId: floor.id,
      after: floor,
    });
    return floor;
  }

  @Patch('floors/:id')
  @RequirePermissions(PERMISSIONS.BRANCH_MANAGE)
  updateFloor(@Param('id') id: string, @Body() dto: UpdateFloorDto) {
    return this.property.updateFloor(id, dto);
  }

  // --- Rooms -------------------------------------------------------------

  @Post('floors/:id/rooms')
  @RequirePermissions(PERMISSIONS.ROOM_MANAGE)
  async createRoom(
    @Param('id') id: string,
    @Body() dto: CreateRoomDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const room = await this.property.createRoom(id, dto);
    await this.audit.record({
      actorId: user.id,
      action: 'room.create',
      entityType: 'Room',
      entityId: room.id,
      after: room,
    });
    return room;
  }

  @Get('rooms/:id')
  @RequirePermissions(PERMISSIONS.ROOM_VIEW)
  getRoom(@Param('id') id: string, @Query('asOf') asOf?: string) {
    return this.property.getRoom(id, asOf ? new Date(asOf) : new Date());
  }

  @Patch('rooms/:id')
  @RequirePermissions(PERMISSIONS.ROOM_MANAGE)
  async updateRoom(
    @Param('id') id: string,
    @Body() dto: UpdateRoomDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const room = await this.property.updateRoom(id, dto);
    await this.audit.record({
      actorId: user.id,
      action: 'room.update',
      entityType: 'Room',
      entityId: id,
      after: dto,
    });
    return room;
  }

  // --- Vacancy -----------------------------------------------------------

  @Get('vacancy')
  @RequirePermissions(PERMISSIONS.ROOM_VIEW)
  vacancy(@Query() query: VacancyQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.property.vacancy(query, user.branchIds);
  }
}
