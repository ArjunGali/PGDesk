import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/permissions';
import { AuditService } from '../audit/audit.service';
import { SettlementsService } from '../settlements/settlements.service';
import {
  AssignBedDto,
  ChangeFoodDto,
  CreateCustomFieldDto,
  CreateStayDto,
  CreateTenantDto,
  GiveNoticeDto,
  SetCustomRentDto,
  SwitchRoomDto,
  TenantQueryDto,
  UpdateTenantDto,
  VacateDto,
} from './dto';
import { StaysService } from './stays.service';
import { TenantsService } from './tenants.service';

@Controller()
export class TenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly stays: StaysService,
    private readonly settlements: SettlementsService,
    private readonly audit: AuditService,
  ) {}

  // --- Search ------------------------------------------------------------

  @Get('search')
  @RequirePermissions(PERMISSIONS.TENANT_VIEW)
  search(@Query('q') q: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tenants.search(q ?? '', user.branchIds, {
      canSeeSensitive:
        user.isOwner ||
        user.permissions.includes(PERMISSIONS.TENANT_VIEW_SENSITIVE),
    });
  }

  // --- Tenants -----------------------------------------------------------

  @Get('tenants')
  @RequirePermissions(PERMISSIONS.TENANT_VIEW)
  list(@Query() query: TenantQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tenants.list(query, user.branchIds);
  }

  @Get('tenants/:id')
  @RequirePermissions(PERMISSIONS.TENANT_VIEW)
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tenants.findOne(id, {
      canSeeSensitive:
        user.isOwner ||
        user.permissions.includes(PERMISSIONS.TENANT_VIEW_SENSITIVE),
    });
  }

  @Get('tenants/:id/completeness')
  @RequirePermissions(PERMISSIONS.TENANT_VIEW)
  completeness(@Param('id') id: string) {
    return this.tenants.profileCompleteness(id);
  }

  @Post('tenants')
  @RequirePermissions(PERMISSIONS.TENANT_CREATE)
  async create(
    @Body() dto: CreateTenantDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const tenant = await this.tenants.create(dto);
    await this.audit.record({
      actorId: user.id,
      action: 'tenant.create',
      entityType: 'Tenant',
      entityId: tenant.id,
      after: { fullName: tenant.fullName },
    });
    return tenant;
  }

  @Patch('tenants/:id')
  @RequirePermissions(PERMISSIONS.TENANT_EDIT)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTenantDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const tenant = await this.tenants.update(id, dto);
    await this.audit.record({
      actorId: user.id,
      action: 'tenant.update',
      entityType: 'Tenant',
      entityId: id,
      after: dto,
    });
    return tenant;
  }

  @Post('tenants/:id/archive')
  @RequirePermissions(PERMISSIONS.TENANT_ARCHIVE)
  async archive(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const tenant = await this.tenants.archive(id);
    await this.audit.record({
      actorId: user.id,
      action: 'tenant.archive',
      entityType: 'Tenant',
      entityId: id,
      reason: body?.reason,
    });
    return tenant;
  }

  // --- Stays -------------------------------------------------------------

  @Post('tenants/:id/stays')
  @RequirePermissions(PERMISSIONS.TENANT_CREATE)
  createStay(
    @Param('id') id: string,
    @Body() dto: CreateStayDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.stays.createStay(id, dto, user.id);
  }

  @Get('stays/:id')
  @RequirePermissions(PERMISSIONS.TENANT_VIEW)
  getStay(@Param('id') id: string) {
    return this.stays.getStay(id);
  }

  @Post('stays/:id/assign-bed')
  @RequirePermissions(PERMISSIONS.TENANT_ASSIGN)
  assignBed(
    @Param('id') id: string,
    @Body() dto: AssignBedDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.stays.assignBed(id, dto, user.id);
  }

  @Get('stays/:id/switch-preview')
  @RequirePermissions(PERMISSIONS.TENANT_ASSIGN)
  previewSwitch(
    @Param('id') id: string,
    @Query('toBedId') toBedId: string,
    @Query('effectiveDate') effectiveDate: string,
  ) {
    return this.stays.previewSwitch(
      id,
      toBedId,
      effectiveDate ?? new Date().toISOString(),
    );
  }

  @Post('stays/:id/switch-room')
  @RequirePermissions(PERMISSIONS.TENANT_ASSIGN)
  switchRoom(
    @Param('id') id: string,
    @Body() dto: SwitchRoomDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.stays.switchRoom(id, dto, user.id);
  }

  @Post('stays/:id/food')
  @RequirePermissions(PERMISSIONS.TENANT_EDIT)
  changeFood(
    @Param('id') id: string,
    @Body() dto: ChangeFoodDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.stays.changeFood(id, dto, user.id);
  }

  @Post('stays/:id/custom-rent')
  @RequirePermissions(PERMISSIONS.PRICING_MANAGE)
  setCustomRent(
    @Param('id') id: string,
    @Body() dto: SetCustomRentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.stays.setCustomRent(id, dto, user.id);
  }

  // --- Notice, vacate, settlement ---------------------------------------

  @Post('stays/:id/notice')
  @RequirePermissions(PERMISSIONS.TENANT_VACATE)
  giveNotice(
    @Param('id') id: string,
    @Body() dto: GiveNoticeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.stays.giveNotice(id, dto, user.id);
  }

  @Get('stays/:id/settlement-preview')
  @RequirePermissions(PERMISSIONS.SETTLEMENT_VIEW)
  settlementPreview(
    @Param('id') id: string,
    @Query('checkoutDate') checkoutDate?: string,
  ) {
    return this.settlements.preview(
      id,
      checkoutDate ? new Date(checkoutDate) : new Date(),
    );
  }

  @Post('stays/:id/vacate')
  @RequirePermissions(PERMISSIONS.TENANT_VACATE)
  vacate(
    @Param('id') id: string,
    @Body() dto: VacateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settlements.vacate(id, dto, user.id);
  }

  // --- Custom fields -----------------------------------------------------

  @Get('custom-fields')
  @RequirePermissions(PERMISSIONS.TENANT_VIEW)
  listCustomFields() {
    return this.tenants.listCustomFields();
  }

  @Post('custom-fields')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  createCustomField(@Body() dto: CreateCustomFieldDto) {
    return this.tenants.createCustomField(dto);
  }

  @Patch('custom-fields/:id')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  updateCustomField(
    @Param('id') id: string,
    @Body() dto: Partial<CreateCustomFieldDto> & { isActive?: boolean },
  ) {
    return this.tenants.updateCustomField(id, dto);
  }
}
