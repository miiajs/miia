export interface User {
  id: string
  email: string
}

export interface StoredUser extends User {
  passwordHash: string
}
