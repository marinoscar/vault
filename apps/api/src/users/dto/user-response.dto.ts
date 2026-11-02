import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Dates are the wire format (ISO-8601 strings): the OpenAPI generator cannot represent z.date().
export const userResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  providerDisplayName: z.string().nullable(),
  profileImageUrl: z.string().url().nullable(),
  providerProfileImageUrl: z.string().url().nullable(),
  isActive: z.boolean(),
  roles: z.array(z.string()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export class UserResponseDto extends createZodDto(userResponseSchema) {}

// List response with pagination
export const userListResponseSchema = z.object({
  items: z.array(userResponseSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
});

export class UserListResponseDto extends createZodDto(userListResponseSchema) {}
