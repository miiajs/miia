import { z } from 'zod'

// @ValidateForm sees a flat object: text fields as strings next to the files
// under their own names - the same shape OpenAPI uses for a multipart body.
export const UploadFormSchema = z.object({
  title: z.string().min(1).max(255),
  file: z.instanceof(File),
})

export type UploadFormInput = z.infer<typeof UploadFormSchema>
