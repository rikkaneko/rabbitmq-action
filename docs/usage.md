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

### RabbitMQ Action Agent Consumer

Use [`rikkaneko/rabbitmq-action-agent`](https://github.com/rikkaneko/rabbitmq-action-agent) when the consumer should run scripts on a host machine. The agent consumes messages from a configured queue, resolves the payload `target` to an executable script in `script_dir`, and returns script status through direct reply-to when `replyTo` is present.

Minimal agent config:

```yaml
amqp_url: amqps://rabbitmq.example.test:5671/vhost
queue: deploy-jobs
script_dir: /opt/rabbitmq-action-agent/scripts
```

Publish a target payload from this action:

```yaml
with:
  amqp_url: ${{ secrets.AMQP_URL }}
  queue: deploy-jobs
  require_ack: 'true'
  ack_timeout: '60000'
  payload: |-
    {
      "target": "git-pull-docker-up-build",
      "path": "/srv/example-org/example-api-service",
      "service": ["api", "cms"]
    }
```

Payloads for the agent must be JSON objects with a non-empty string `target`. The target must be a safe script basename, not a nested path. The script receives the raw JSON payload as `PAYLOAD` and supported top-level JSON fields as `PAYLOAD_<KEY>` environment variables, such as `PAYLOAD_TARGET`, `PAYLOAD_PATH`, and `PAYLOAD_SERVICE`.

Use a dedicated queue for each host running the agent. Multiple agents consuming the same queue compete for work, so RabbitMQ normally delivers each message to only one agent. For simultaneous multi-node delivery, bind one queue per host to a fanout exchange and publish to that exchange.
