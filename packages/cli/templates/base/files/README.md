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

Environment variables are validated by `src/env.schema.ts` and read through `ConfigService`. `.env.example` lists them with defaults; `.env` holds your local values and is not committed.

## Next steps

- `{{exec}} g resource posts` - a CRUD module with route schemas and a test
- `{{exec}} add swagger` - OpenAPI docs at `/docs`
- Docs: https://miiajs.com/docs
