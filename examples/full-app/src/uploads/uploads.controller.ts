import { Controller, inject, Post, Status, UseGuard } from '@miiajs/core'
import { AuthGuard } from '@miiajs/auth'
import { Multipart, type MultipartContext, ValidateForm } from '@miiajs/multipart'
import { RateLimit } from '@miiajs/rate-limit'
import { ApiBody, ApiOperation, ApiResponse, ApiSecurity, ApiTag } from '@miiajs/swagger'
import { JwtAuth } from '../auth/providers/index.js'
import { type UploadFormInput, UploadFormSchema } from './schemas/index.js'
import { ALLOWED_TYPES, MAX_FILE_SIZE, MAX_FILES, type StoredFile, UploadsService } from './uploads.service.js'

@Controller('uploads')
@ApiTag('Uploads')
@ApiSecurity('bearer')
@UseGuard(AuthGuard(JwtAuth))
// Own bucket: uploads are heavier than the rest of the example, and without a
// policy here they would share the app-wide guard quota (5 requests / 20s).
@RateLimit({ limit: 10, window: '1m' })
export class UploadsController {
  private uploads = inject(UploadsService)

  @Post('stream')
  @Status(201)
  @ApiOperation({
    summary: 'Stream files to disk',
    description:
      'Streaming path: each part is piped straight to public/uploads, so the process never holds a whole file. Up to 3 files, 2MB each. Text fields are echoed back.',
  })
  @ApiBody(
    {
      type: 'object',
      properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } } },
      required: ['files'],
    },
    { contentType: 'multipart/form-data' },
  )
  @ApiResponse(201, { description: 'Files stored. Returns their public URLs.' })
  @ApiResponse(400, { description: 'Body is not multipart/form-data, or the parse failed.' })
  @ApiResponse(413, { description: 'A file, or the body as a whole, exceeded the limit.' })
  @ApiResponse(415, { description: 'A file declared a media type outside the allowed list.' })
  @Multipart({ maxFileSize: MAX_FILE_SIZE, maxFiles: MAX_FILES, allowedTypes: ALLOWED_TYPES })
  async stream(ctx: MultipartContext) {
    const files: StoredFile[] = []
    const fields: Record<string, string> = {}

    // One part at a time: moving to the next one discards whatever this
    // iteration left unread.
    for await (const part of ctx.parts) {
      if (part.type === 'field') {
        fields[part.name] = part.value
        continue
      }
      files.push(await this.uploads.store(part))
    }

    return { fields, files }
  }

  @Post('form')
  @ApiOperation({
    summary: 'Buffered form with schema validation',
    description:
      'Buffered path: the form is collected first, so the schema can check a flat object - the "title" string next to the File under its own name. The file stays in memory here, which is what makes validation-before-storage possible.',
  })
  @ApiBody(
    {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 255 },
        file: { type: 'string', format: 'binary' },
      },
      required: ['title', 'file'],
    },
    { contentType: 'multipart/form-data' },
  )
  @ApiResponse(200, { description: 'Parsed and validated form.' })
  @ApiResponse(400, { description: 'Body is not multipart/form-data, or the parse failed.' })
  @ApiResponse(413, { description: 'The file, or the body as a whole, exceeded the limit.' })
  @ApiResponse(415, { description: 'The file declared a media type outside the allowed list.' })
  @ApiResponse(422, { description: 'Form failed schema validation.' })
  @Multipart({ maxFileSize: MAX_FILE_SIZE, maxFiles: 1, allowedTypes: ALLOWED_TYPES })
  @ValidateForm(UploadFormSchema)
  async form(ctx: MultipartContext) {
    // After @ValidateForm the cache holds the schema's data, not the raw FormResult.
    const { title, file } = await ctx.form<UploadFormInput>()
    return {
      title,
      filename: file.name,
      size: file.size,
      mediaType: file.type,
    }
  }
}
