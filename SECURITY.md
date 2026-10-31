# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Security Considerations for Local Deployment

This application is designed as a **Local On-Premise Studio**. Please keep the following security recommendations in mind if deploying or exposing services:

1. **Localhost Binding**:
   - By default, the Express server (`:3001`), Python microservice (`:5002`), and Qdrant (`:6333`) are intended to run on `localhost` (127.0.0.1).
   - If deploying on a remote VM or cloud server, **do not expose port 6333 or port 3001 publicly** without setting up authentication (such as a reverse proxy with TLS/HTTPS, basic auth, or VPN).

2. **Filesystem Explorer (`/api/browse-fs`)**:
   - The filesystem explorer is designed for navigating local disks on the host machine.
   - In multi-user or public environments, restrict or disable this endpoint or place the entire application behind an authenticated proxy.

3. **Reporting a Vulnerability**:
   - If you discover a security vulnerability, please open a private security advisory or contact the maintainer via GitHub issues/discussions.

