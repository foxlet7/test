import { PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';

export class ZodPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}
  transform(value: unknown): T {
    return this.schema.parse(value); // ZodError -> VALIDATION_FAILED via AllExceptionsFilter
  }
}
export const z$ = <T>(schema: ZodSchema<T>) => new ZodPipe(schema);
