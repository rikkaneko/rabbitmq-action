# Usage

## Publish Targets

Use exactly one target mode.

Queue mode publishes to the default exchange with the queue name as the routing key:

```yaml
with:
  amqp_url: ${{ secrets.AMQP_URL }}
  queue: content-jobs
  payload: |-
    {"job":"sync"}
```

Exchange mode publishes to the provided exchange and optional routing key:

```yaml
with:
  amqp_url: ${{ secrets.AMQP_URL }}
  exchange: content.events
  route_key: content.created
  payload: |-
    {"id":"123"}
```

Payload input is trimmed before publishing. JSON payloads may use plain YAML block scalar syntax (`|`), but `|-` is preferred when you do not want YAML to preserve the final newline.

## Headers

Headers use newline-separated `key=value` entries. Values are sent as strings.

```yaml
with:
  header: |
    source=github-actions
    priority=high
```

## Authentication

mTLS is used when all certificate inputs are present:

```yaml
with:
  amqp_cert_chain: ${{ secrets.AMQP_CERT_CHAIN }}
  amqp_cert_key: ${{ secrets.AMQP_CERT_KEY }}
  amqp_cert_ca: ${{ secrets.AMQP_CERT_CA }}
```

Username/password authentication is used when mTLS is incomplete and both plain credentials are present:

```yaml
with:
  amqp_username: ${{ secrets.AMQP_USERNAME }}
  amqp_password: ${{ secrets.AMQP_PASSWORD }}
```

## Consumer Acknowledgement

When `require_ack` is `true`, the action uses RabbitMQ direct reply-to. The consumer must publish a reply to the received `replyTo` value and reuse the received `correlationId`.

```yaml
with:
  require_ack: 'true'
  ack_timeout: '5000'
```
