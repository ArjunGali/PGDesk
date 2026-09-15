import { CustomFieldType, StayType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateTenantDto {
  @IsString() @IsNotEmpty() fullName: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsString() emergencyContact?: string;
  @IsOptional() @IsString() emergencyName?: string;
  @IsOptional() @IsString() permanentAddress?: string;
  @IsOptional() @IsString() officeAddress?: string;
  @IsOptional() @IsString() officeName?: string;
  @IsOptional() @IsString() aadhaarNumber?: string;
  @IsOptional() @IsString() notes?: string;
  /** Custom field values keyed by definition key. */
  @IsOptional() customFields?: Record<string, string>;
}

/**
 * Every field is optional on update, including the name: a profile can be
 * saved incomplete and filled in later.
 */
export class UpdateTenantDto {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsString() emergencyContact?: string;
  @IsOptional() @IsString() emergencyName?: string;
  @IsOptional() @IsString() permanentAddress?: string;
  @IsOptional() @IsString() officeAddress?: string;
  @IsOptional() @IsString() officeName?: string;
  @IsOptional() @IsString() aadhaarNumber?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() photoDocumentId?: string;
  @IsOptional() customFields?: Record<string, string>;
}

export class CreateStayDto {
  @IsOptional() @IsEnum(StayType) stayType?: StayType;
  @IsDateString() checkInDate: string;
  @IsOptional() @IsDateString() expectedCheckoutDate?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) plannedDays?: number;
  @IsOptional() @IsNumberString() depositAmount?: string;
  /** Deposit actually collected at check-in; recorded in the deposit ledger. */
  @IsOptional() @IsNumberString() depositCollected?: string;
  @IsOptional() @IsBoolean() foodIncluded?: boolean;
  /** Bed to place the tenant in. Optional: a stay can be created unassigned. */
  @IsOptional() @IsString() bedId?: string;
  /** Rent override for this tenant only. */
  @IsOptional() @IsNumberString() customRent?: string;
  @IsOptional() @IsString() customRentReason?: string;
  @IsOptional() @IsString() notes?: string;
}

export class ChangeFoodDto {
  @IsBoolean() foodIncluded: boolean;
  @IsDateString() effectiveFrom: string;
  @IsOptional() @IsString() reason?: string;
}

export class SetCustomRentDto {
  @IsNumberString() amount: string;
  @IsDateString() effectiveFrom: string;
  @IsString() @IsNotEmpty() reason: string;
}

export class AssignBedDto {
  @IsString() @IsNotEmpty() bedId: string;
  @IsDateString() startDate: string;
  @IsOptional() @IsString() reason?: string;
}

export class SwitchRoomDto {
  @IsString() @IsNotEmpty() toBedId: string;
  @IsDateString() effectiveDate: string;
  @IsOptional() @IsString() reason?: string;
  /**
   * When the destination bed is occupied, the two tenants exchange beds.
   * The preview endpoint tells the UI whether this will happen.
   */
  @IsOptional() @IsBoolean() allowSwap?: boolean;
}

export class GiveNoticeDto {
  @IsDateString() noticeDate: string;
  @IsDateString() intendedCheckout: string;
  @IsOptional() @IsString() reason?: string;
}

export class VacateDto {
  @IsDateString() checkoutDate: string;
  @IsOptional() @IsString() reason?: string;
  /** Skip straight to a finalised settlement instead of leaving it a draft. */
  @IsOptional() @IsBoolean() finaliseSettlement?: boolean;
}

export class CreateCustomFieldDto {
  @IsString() @IsNotEmpty() key: string;
  @IsString() @IsNotEmpty() label: string;
  @IsOptional() @IsEnum(CustomFieldType) type?: CustomFieldType;
  @IsOptional() @IsArray() options?: string[];
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
}

export class TenantQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() incompleteOnly?: string;
  @IsOptional() @Type(() => Number) @IsInt() page?: number;
  @IsOptional() @Type(() => Number) @IsInt() pageSize?: number;
}
