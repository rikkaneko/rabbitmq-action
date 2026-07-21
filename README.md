# RabbitMQ Publish Action

GitHub Action for publishing custom payload to a RabbitMQ or AMQP exchange or queue.

## Installation

Use this action from a workflow after checking out the repository that contains it, or reference a released tag from your action repository.

```yaml
- uses: rabbitmq-action@v1
  with:
    amqp_url: ${{ secrets.AMQP_URL }}
    exchange: content.events
    route_key: content.created
    payload: |-
      {"id":"123"}
```

## Environment Configuration

All connection values are supplied as action inputs. Store credentials and certificate PEM values in GitHub Secrets.

Required input:
- `amqp_url`
- `payload` trims leading and trailing whitespace before publishing, which supports YAML block scalars such as `|` and `|-`.
- One publish target: either `queue` or `exchange`

Authentication inputs:
- `amqp_username` and `amqp_password` for username/password authentication
- `amqp_cert_chain`, `amqp_cert_key`, and `amqp_cert_ca` for mTLS authentication

## Features

- Publishes to a named queue through the default exchange.
- Publishes to an exchange with an optional routing key.
- Supports username/password authentication and mTLS certificate authentication.
- Supports newline-separated `key=value` AMQP headers.
- Supports optional consumer acknowledgement through RabbitMQ direct reply-to.
- Validates action inputs before connecting to AMQP.

## Usage Examples

Publish to a queue:

```yaml
- uses: rabbitmq-action@v1
  with:
    amqp_url: ${{ secrets.AMQP_URL }}
    queue: content-jobs
    payload: |-
      {"job":"sync"}
```

Publish to an exchange with headers:

```yaml
- uses: rabbitmq-action@v1
  with:
    amqp_url: ${{ secrets.AMQP_URL }}
    amqp_username: ${{ secrets.AMQP_USERNAME }}
    amqp_password: ${{ secrets.AMQP_PASSWORD }}
    exchange: content.events
    route_key: content.created
    header: |
      source=github-actions
      priority=high
    payload: |-
      {"id":"123"}
```

Publish with mTLS and consumer acknowledgement:

```yaml
- uses: rabbitmq-action@v1
  with:
    amqp_url: ${{ secrets.AMQP_URL }}
    amqp_cert_chain: ${{ secrets.AMQP_CERT_CHAIN }}
    amqp_cert_key: ${{ secrets.AMQP_CERT_KEY }}
    amqp_cert_ca: ${{ secrets.AMQP_CERT_CA }}
    queue: content-jobs
    payload: |-
      {"job":"sync"}
    require_ack: 'true'
    ack_timeout: '5000'
```

### Use `rikkaneko/rabbitmq-action-agent` as the consumer

[`rikkaneko/rabbitmq-action-agent`](https://github.com/rikkaneko/rabbitmq-action-agent) consumes messages from a configured queue, runs a host script selected by the JSON payload `target`, and can reply through RabbitMQ direct reply-to when acknowledgement is requested.

```yaml
- uses: rikkaneko/rabbitmq-action@v1
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

The agent must be configured to consume the same queue. When `require_ack` is `true`, this action waits for the agent to finish the target script and return a direct reply-to acknowledgement.

## Development

```sh
pnpm install
pnpm run lint
pnpm run test
pnpm run build
```

## License

GPLv3
