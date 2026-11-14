# The static site served by nginx. Build from the repository root:
#   docker build -f apps/website/Dockerfile -t miia-website .

FROM oven/bun:1.4.4 AS build
WORKDIR /repo
COPY . .
# No install scripts: lefthook needs .git, and `generate` prepares Nuxt itself
RUN bun install --frozen-lockfile --ignore-scripts
WORKDIR /repo/apps/website
RUN bun run generate

FROM nginxinc/nginx-unprivileged:1-alpine
LABEL org.opencontainers.image.source="https://github.com/miiajs/miia"
COPY apps/website/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/website/.output/public /usr/share/nginx/html
EXPOSE 8080
