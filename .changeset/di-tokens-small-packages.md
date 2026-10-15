---
'@miiajs/jwt': minor
'@miiajs/config': minor
'@miiajs/rate-limit': minor
'@miiajs/swagger': minor
---

Option tokens are typed `createToken()` objects and stay inside their packages. "No provider" errors name the module to import: `JwtService is provided by JwtModule.configure()`, likewise for `ConfigService` and `SwaggerService`, and for the JWT and Swagger options when the service is provided without its module. Breaking:

- `JWT_OPTIONS`, `RATE_LIMIT_OPTIONS` and `SWAGGER_OPTIONS` are no longer exported - configure the packages through `JwtModule.configure()`, `RateLimitModule.configure()` and `SwaggerModule.configure()`
- `ConfigService` is no longer registered under the string `'ConfigService'` - resolve it by the class
