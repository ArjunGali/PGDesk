import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/permissions';
import { AuditService } from '../audit/audit.service';
import { ExpensesService } from './expenses.service';

class CreateExpenseDto {
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsString() @IsNotEmpty() title: string;
  @IsNumberString() amount: string;
  @IsDateString() spentAt: string;
  @IsOptional() @IsString() paidTo?: string;
  @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
  @IsOptional() @IsString() notes?: string;
}

class ExpenseQueryDto {
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() page?: number;
  @IsOptional() @Type(() => Number) @IsInt() pageSize?: number;
}

@Controller('expenses')
export class ExpensesController {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly audit: AuditService,
  ) {}

  @Get('categories')
  @RequirePermissions(PERMISSIONS.EXPENSE_VIEW)
  listCategories() {
    return this.expenses.listCategories();
  }

  @Post('categories')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  createCategory(@Body() dto: { key: string; name: string; sortOrder?: number }) {
    return this.expenses.createCategory(dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.EXPENSE_VIEW)
  list(@Query() query: ExpenseQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.expenses.list({
      ...query,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      branchScope: user.branchIds,
    });
  }

  @Get('summary')
  @RequirePermissions(PERMISSIONS.EXPENSE_VIEW)
  summary(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.expenses.summary(new Date(from), new Date(to), branchId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.EXPENSE_MANAGE)
  async create(
    @Body() dto: CreateExpenseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const expense = await this.expenses.create(dto, user.id);
    await this.audit.record({
      actorId: user.id,
      action: 'expense.create',
      entityType: 'Expense',
      entityId: expense.id,
      after: dto,
    });
    return expense;
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.EXPENSE_MANAGE)
  async update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateExpenseDto>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const expense = await this.expenses.update(id, dto);
    await this.audit.record({
      actorId: user.id,
      action: 'expense.update',
      entityType: 'Expense',
      entityId: id,
      after: dto,
    });
    return expense;
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.EXPENSE_MANAGE)
  async remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.audit.record({
      actorId: user.id,
      action: 'expense.delete',
      entityType: 'Expense',
      entityId: id,
    });
    return this.expenses.remove(id);
  }
}
