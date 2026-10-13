# Security Policy

## Reporting a Vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

Instead, report privately via GitHub Security Advisories:
https://github.com/miiajs/miia/security/advisories/new

We acknowledge reports within 72 hours and aim to ship fixes within 14 days
for critical issues.

## Supported Versions

During the `0.x` pre-release phase, only the latest minor version receives
security updates.

## Runtime versions

The `engines` field of each package names the oldest runtime the code works on, not a security
baseline. Every supported Node.js, Bun and Deno line receives security fixes, often in the HTTP
stack a Miia server runs on, so run the latest patch release of your line. For example, Node.js
24.17.0 and 24.18.1 fixed http2 header memory retention, response queue poisoning in `http.Agent`,
and requests over the maximum header count.
