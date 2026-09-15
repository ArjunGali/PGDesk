import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/permissions';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TENANT_VIEW)
  list(@Query('unreadOnly') unreadOnly?: string, @Query('limit') limit?: string) {
    return this.notifications.list({
      unreadOnly: unreadOnly === 'true',
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('refresh')
  @RequirePermissions(PERMISSIONS.TENANT_VIEW)
  refresh() {
    return this.notifications.refreshAll();
  }

  @Post('read')
  @RequirePermissions(PERMISSIONS.TENANT_VIEW)
  markRead(@Body() dto: { ids: string[] }) {
    return this.notifications.markRead(dto.ids ?? []);
  }

  @Post('read-all')
  @RequirePermissions(PERMISSIONS.TENANT_VIEW)
  markAllRead() {
    return this.notifications.markAllRead();
  }
}
