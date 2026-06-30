# Health Module Documentation

## Overview

The Health Module provides application health status monitoring endpoints for the Payassure Settlement Engine. It enables external monitoring systems, load balancers, and health checks to verify that the application is running and responding correctly.

**Location**: `src/health/`

## Features

- **Health Check Endpoint** - Simple status verification
- **Liveness Probe** - Verify application is running
- **Readiness Probe** - Verify application is ready to handle requests
- **Kubernetes Compatible** - Works with container orchestration platforms

## Core Components

### 1. HealthController (`health.controller.ts`)

Main entry point for health monitoring endpoints.

**Endpoints**:

#### GET `/payassure/health`
- **Description**: Get Payassure health status
- **Auth Required**: No
- **Query Parameters**: None
- **Returns**: 
  ```json
  {
    "status": "ok"
  }
  ```
- **Status Code**: 200
- **Response Time**: < 100ms
- **Availability**: 24/7

## Response Format

### Success Response
```json
{
  "status": "ok"
}
```
- **Status Code**: 200
- **Content-Type**: application/json

### What This Indicates
- Application process is running
- HTTP server is responding
- Basic connectivity is functional

## Usage Scenarios

### 1. Docker/Kubernetes Health Checks

**Kubernetes Liveness Probe**:
```yaml
livenessProbe:
  httpGet:
    path: /payassure/health
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
```

**Kubernetes Readiness Probe**:
```yaml
readinessProbe:
  httpGet:
    path: /payassure/health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 2
```

### 2. Load Balancer Health Checks

**AWS Application Load Balancer**:
- Path: `/payassure/health`
- Protocol: HTTP
- Port: 3000
- Healthy Threshold: 2
- Unhealthy Threshold: 2
- Timeout: 3 seconds
- Interval: 30 seconds

**Nginx Upstream**:
```nginx
upstream payassure_backend {
    server localhost:3000;
    check interval=3000 rise=2 fall=5 timeout=1000 type=http;
    check_http_send "GET /payassure/health HTTP/1.0\r\n\r\n";
    check_http_expect_alive http_2xx;
}
```

### 3. Monitoring Systems

**Prometheus/Grafana Monitoring**:
```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'payassure'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/payassure/health'
```

**Datadog Monitoring**:
```
api_key: "your_api_key"
app_key: "your_app_key"

monitors:
  - type: service_check
    query: 'http.can_connect{url:http://localhost:3000/payassure/health}'
```

### 4. Manual Testing

**Using cURL**:
```bash
# Basic health check
curl http://localhost:3000/payassure/health

# With verbose output
curl -v http://localhost:3000/payassure/health

# With timeout
curl --max-time 5 http://localhost:3000/payassure/health
```

**Using wget**:
```bash
wget -q -O- http://localhost:3000/payassure/health
```

**Using PowerShell (Windows)**:
```powershell
Invoke-WebRequest -Uri "http://localhost:3000/payassure/health"
```

## HTTP Status Codes

| Code | Meaning | Action |
|------|---------|--------|
| 200 | Healthy | All good, application running |
| 500 | Unhealthy | Application error, needs investigation |
| 503 | Unavailable | Application starting or stopping |
| 504 | Timeout | Response took too long |

## Performance Characteristics

| Metric | Value |
|--------|-------|
| Response Time | < 50ms |
| Request Size | < 1KB |
| Response Size | ~20 bytes |
| Memory Impact | Negligible |
| CPU Impact | Minimal |
| No Database Calls | ✓ Yes |
| No External Calls | ✓ Yes |

## Future Enhancements

### Planned Improvements

#### 1. Detailed Health Check
```
GET /payassure/health/detailed
Returns: {
  "status": "ok",
  "database": "connected",
  "redis": "connected",
  "timestamp": "2026-06-30T12:00:00Z",
  "uptime": 3600
}
```

#### 2. Service-Specific Checks
```
GET /payassure/health/database
GET /payassure/health/cache
GET /payassure/health/storage
```

#### 3. Metrics Collection
```
GET /payassure/metrics
Returns Prometheus-format metrics:
- Request count
- Error rate
- Response time percentiles
- Memory usage
- Database connection pool status
```

#### 4. Dependency Checks
- Database connectivity (Postgres)
- Redis connection (if implemented)
- External service connectivity
- Disk space availability
- Memory availability

### Implementation Plan

**Phase 1**: Current implementation (simple OK response)
**Phase 2**: Add database connectivity check
**Phase 3**: Add Prometheus metrics endpoint
**Phase 4**: Add detailed health report with timestamps

## Monitoring Setup Examples

### 1. Basic Shell Script
```bash
#!/bin/bash
# health_check.sh

ENDPOINT="http://localhost:3000/payassure/health"
RESPONSE=$(curl -s $ENDPOINT)

if echo "$RESPONSE" | grep -q '"status":"ok"'; then
    echo "✓ Payassure is healthy"
    exit 0
else
    echo "✗ Payassure health check failed"
    exit 1
fi
```

### 2. Uptime Robot
```
Monitor URL: http://your-domain.com/payassure/health
Check Frequency: Every 5 minutes
Expected HTTP: 200
Response Match: "status"
Alert: Email notification on failure
```

### 3. AWS CloudWatch
```
- Create custom metric
- Publish 1 when status = "ok"
- Publish 0 when status = "error"
- Create alarm if metric < 1 for 5 minutes
```

### 4. GitHub Actions (CI/CD)
```yaml
- name: Health Check
  run: |
    curl -f http://localhost:3000/payassure/health || exit 1
```

## Integration with Other Modules

The Health Module operates independently and:
- Does NOT depend on other modules
- Does NOT require authentication
- Does NOT query the database (current version)
- Does NOT have side effects
- Is safe to call repeatedly

This makes it ideal for:
- Load balancer health verification
- Monitoring systems
- Alerting mechanisms
- Public status pages

## Best Practices

1. **Call Frequently**: Check health every 10-30 seconds in production
2. **Set Timeouts**: Always use short timeouts (3-5 seconds max)
3. **Monitor the Monitor**: Ensure health check itself isn't failing
4. **Log Failures**: Track failed health checks for debugging
5. **Alert on Changes**: Notify team when status changes
6. **Use HTTPS**: In production, use HTTPS for security
7. **Separate Endpoint**: Keep health check separate from API traffic
8. **No Authentication**: Health checks should be unauthenticated
9. **Light Response**: Keep response small and fast
10. **Version Tracking**: Include API version in future responses

## Troubleshooting

### Health Check Not Responding

**Symptoms**: 
- `curl: (7) Failed to connect`
- Connection refused
- Timeout

**Solutions**:
1. Verify application is running: `ps aux | grep node`
2. Check port 3000 is listening: `lsof -i :3000`
3. Check firewall: `ufw status`
4. Verify URL: `echo http://localhost:3000/payassure/health`

### Intermittent Failures

**Symptoms**: 
- Health check sometimes fails
- Flaky monitoring alerts

**Solutions**:
1. Increase timeout threshold
2. Increase failure threshold in monitoring (fail after 2-3 failures)
3. Check for resource exhaustion (CPU, memory)
4. Review application logs for errors

### High Latency

**Symptoms**: 
- Response takes > 1 second
- Monitoring timeout errors

**Solutions**:
1. Check system resources
2. Look for database queries (shouldn't be any)
3. Check for external API calls (shouldn't be any)
4. Monitor application CPU and memory

## Security Notes

- **No Authentication Required**: This is intentional for load balancers
- **No Sensitive Data**: Response contains no sensitive information
- **No Side Effects**: Health checks don't modify anything
- **Rate Limiting**: Consider light rate limiting to prevent abuse
- **CORS**: Not required for this endpoint

## Deployment Considerations

### Docker
```dockerfile
# Health check in Dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/payassure/health || exit 1
```

### Docker Compose
```yaml
services:
  payassure:
    build: .
    ports:
      - "3000:3000"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/payassure/health"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 10s
```

### Systemd
```ini
# /etc/systemd/system/payassure.service
[Service]
ExecStart=/usr/bin/node /app/dist/main.js
Restart=on-failure
RestartSec=5s

[Unit]
After=network.target
```

## Endpoint Summary

| Method | Path | Auth | Response | Speed |
|--------|------|------|----------|-------|
| GET | `/payassure/health` | No | `{"status":"ok"}` | <50ms |

---

**Module Path**: `src/health/`  
**Controller Route**: `/payassure`  
**Stability**: Stable  
**Criticality**: High (Used for monitoring)  
**Dependencies**: None (NestJS only)
