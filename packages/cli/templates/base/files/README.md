# {{name}}

A [MiiaJS](https://miiajs.com) app.

## Scripts

| Command | What it does |
| --- | --- |
| `{{run:dev}}` | Dev server with reload and type-checking |
| `{{run:test}}` | Tests (`src/**/*.test.ts`) |
| `{{run:check}}` | Type-check |
| `{{run:build}}` | Build |
| `{{run:start}}` | Production server |

## Configuration

Environment variables are validated by `src/env.schema.ts` and read through `ConfigService`. `.env.example` lists every variable, with a value where it is safe to share; secrets such as `JWT_SECRET` stay empty there, and the app does not start until you set them. `.env` holds your local values (secrets generated when the project was created) and is not committed. `NODE_ENV` is set by the scripts: `development` for `dev`, `production` for `start`.

## Next steps

- `{{exec}} g resource posts` - a CRUD module with route schemas and a test
- `{{exec}} add swagger` - OpenAPI docs at `/docs`
- Docs: https://miiajs.com/docs
