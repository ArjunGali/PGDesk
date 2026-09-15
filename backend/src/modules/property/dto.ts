import { AcType, BranchStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateBranchDto {
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() contact?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
}

export class UpdateBranchDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() contact?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsEnum(BranchStatus) status?: BranchStatus;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
}

export class CreateFloorTypeDto {
  @IsString() @IsNotEmpty() key: string;
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
}

export class CreateFloorDto {
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsString() floorTypeId?: string;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
}

export class UpdateFloorDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() floorTypeId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
}

export class CreateRoomDto {
  @IsString() @IsNotEmpty() name: string;

  /** Sharing size. Beds are created automatically to match. */
  @Type(() => Number) @IsInt() @Min(1) @Max(50) capacity: number;

  @IsOptional() @IsEnum(AcType) acType?: AcType;
  @IsOptional() @IsString() variant?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
  /** Override the generated bed labels (A, B, C...). */
  @IsOptional() bedLabels?: string[];
}

export class UpdateRoomDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) capacity?: number;
  @IsOptional() @IsEnum(AcType) acType?: AcType;
  @IsOptional() @IsString() variant?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
}

export class VacancyQueryDto {
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() floorId?: string;
  @IsOptional() @Type(() => Number) @IsInt() capacity?: number;
  @IsOptional() @IsEnum(AcType) acType?: AcType;
  /** Occupancy is evaluated on this date; defaults to today. */
  @IsOptional() @IsString() asOf?: string;
  /** Include beds freeing up within this many days as "upcoming". */
  @IsOptional() @Type(() => Number) @IsInt() upcomingDays?: number;
}
