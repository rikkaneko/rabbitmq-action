import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsumeMessage } from 'amqplib';

interface MockInputs {
  amqp_url?: string;
  amqp_username?: string;
  amqp_password?: string;
  amqp_cert_chain?: string;
  amqp_cert_key?: string;
  amqp_cert_ca?: string;
  exchange?: string;
  queue?: string;
  route_key?: string;
  header?: string;
  payload?: string;
  require_ack?: string;
  ack_timeout?: string;
}

interface ConsumeRegistration {
  queue: string;
  callback: (message: ConsumeMessage | null) => void;
  options: { noAck: boolean };
}

const mocks = vi.hoisted(() => ({
  inputs: {} as MockInputs,
  consumeRegistrations: [] as ConsumeRegistration[],
  publishMock: vi.fn(),
  closeChannelMock: vi.fn(),
  closeConnectionMock: vi.fn(),
  cancelMock: vi.fn(),
  consumeMock: vi.fn(),
  connectMock: vi.fn(),
  externalCredentials: { mechanism: 'EXTERNAL' },
  plainCredentials: { mechanism: 'PLAIN' },
  setFailedMock: vi.fn(),
  setSecretMock: vi.fn(),
  infoMock: vi.fn(),
}));

vi.mock('@actions/core', () => ({
  getInput: vi.fn((name: keyof MockInputs, options?: { required?: boolean }) => {
    const value = mocks.inputs[name] ?? '';

    if (options?.required && !value) {
      throw new Error(`Input required and not supplied: ${name}`);
    }

    return value;
  }),
  info: mocks.infoMock,
  setFailed: mocks.setFailedMock,
  setSecret: mocks.setSecretMock,
}));

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'correlation-id'),
}));

vi.mock('amqplib', () => ({
  default: {
    connect: mocks.connectMock,
    credentials: {
      external: vi.fn(() => mocks.externalCredentials),
      plain: vi.fn(() => mocks.plainCredentials),
    },
  },
}));

const {
  inputs,
  consumeRegistrations,
  publishMock,
  closeChannelMock,
  closeConnectionMock,
  cancelMock,
  consumeMock,
  connectMock,
  externalCredentials,
  plainCredentials,
  setFailedMock,
} = mocks;

describe('rabbitmq action', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();

    for (const key of Object.keys(inputs) as Array<keyof MockInputs>) {
      delete inputs[key];
    }

    consumeRegistrations.length = 0;
    inputs.amqp_url = 'amqps://rabbitmq.example.test';
    inputs.payload = 'hello world';
    inputs.require_ack = 'false';

    publishMock.mockReturnValue(true);
    closeChannelMock.mockResolvedValue(undefined);
    closeConnectionMock.mockResolvedValue(undefined);
    cancelMock.mockResolvedValue(undefined);
    consumeMock.mockImplementation(
      async (queue: string, callback: (message: ConsumeMessage | null) => void, options: { noAck: boolean }) => {
        consumeRegistrations.push({ queue, callback, options });
        return { consumerTag: 'consumer-tag' };
      }
    );
    connectMock.mockResolvedValue({
      createChannel: async () => ({
        publish: publishMock,
        consume: consumeMock,
        cancel: cancelMock,
        close: closeChannelMock,
      }),
      close: closeConnectionMock,
    });
  });

  it('publishes queue target through the default exchange', async () => {
    inputs.queue = 'jobs';

    await import('./index');

    expect(publishMock).toHaveBeenCalledWith(
      '',
      'jobs',
      Buffer.from('hello world', 'utf8'),
      expect.objectContaining({ headers: {} })
    );
  });

  it('trims surrounding payload whitespace before publishing', async () => {
    inputs.queue = 'jobs';
    inputs.payload = '  {"job":"sync"}\n';

    await import('./index');

    expect(publishMock).toHaveBeenCalledWith(
      '',
      'jobs',
      Buffer.from('{"job":"sync"}', 'utf8'),
      expect.objectContaining({ headers: {} })
    );
  });

  it('publishes exchange target with route key and headers', async () => {
    inputs.exchange = 'events';
    inputs.route_key = 'content.created';
    inputs.header = 'source=capstone\npriority=high';

    await import('./index');

    expect(publishMock).toHaveBeenCalledWith(
      'events',
      'content.created',
      Buffer.from('hello world', 'utf8'),
      expect.objectContaining({
        headers: {
          source: 'capstone',
          priority: 'high',
        },
      })
    );
  });

  it('rejects both queue and exchange', async () => {
    inputs.queue = 'jobs';
    inputs.exchange = 'events';

    await import('./index');

    expect(setFailedMock).toHaveBeenCalledWith('Provide either queue or exchange, not both.');
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('rejects missing target', async () => {
    await import('./index');

    expect(setFailedMock).toHaveBeenCalledWith('Provide queue or exchange.');
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('rejects malformed header lines', async () => {
    inputs.queue = 'jobs';
    inputs.header = 'invalid';

    await import('./index');

    expect(setFailedMock).toHaveBeenCalledWith('Invalid header line "invalid". Expected key=value.');
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('uses mtls credentials when all certificate values are present', async () => {
    inputs.queue = 'jobs';
    inputs.amqp_cert_chain = 'CERT';
    inputs.amqp_cert_key = 'KEY';
    inputs.amqp_cert_ca = 'CA';

    await import('./index');

    expect(connectMock).toHaveBeenCalledWith(
      'amqps://rabbitmq.example.test',
      expect.objectContaining({
        cert: Buffer.from('CERT', 'utf8'),
        key: Buffer.from('KEY', 'utf8'),
        ca: [Buffer.from('CA', 'utf8')],
        credentials: externalCredentials,
      })
    );
  });

  it('falls back to username and password when mtls values are incomplete', async () => {
    inputs.queue = 'jobs';
    inputs.amqp_username = 'user';
    inputs.amqp_password = 'pass';
    inputs.amqp_cert_chain = 'CERT';

    await import('./index');

    expect(connectMock).toHaveBeenCalledWith(
      'amqps://rabbitmq.example.test',
      expect.objectContaining({ credentials: plainCredentials })
    );
  });

  it('publishes without ack by default', async () => {
    inputs.queue = 'jobs';

    await import('./index');

    expect(consumeMock).not.toHaveBeenCalled();
    expect(publishMock.mock.calls[0][3]).toEqual(
      expect.objectContaining({
        correlationId: undefined,
        replyTo: undefined,
      })
    );
  });

  it('waits for direct reply-to ack with matching correlation id', async () => {
    inputs.queue = 'jobs';
    inputs.require_ack = 'true';
    inputs.ack_timeout = '1000';

    const importPromise = import('./index');

    await vi.waitFor(() => {
      expect(consumeRegistrations).toHaveLength(1);
    });

    consumeRegistrations[0].callback({
      properties: { correlationId: 'correlation-id' },
    } as ConsumeMessage);

    await importPromise;

    expect(consumeRegistrations[0]).toEqual(
      expect.objectContaining({
        queue: 'amq.rabbitmq.reply-to',
        options: { noAck: true },
      })
    );
    expect(cancelMock).toHaveBeenCalledWith('consumer-tag');
    expect(setFailedMock).not.toHaveBeenCalled();
  });

  it('ignores direct reply-to ack with non-matching correlation id', async () => {
    vi.useFakeTimers();
    inputs.queue = 'jobs';
    inputs.require_ack = 'true';
    inputs.ack_timeout = '1000';

    const importPromise = import('./index');

    await vi.waitFor(() => {
      expect(consumeRegistrations).toHaveLength(1);
    });

    consumeRegistrations[0].callback({
      properties: { correlationId: 'other-id' },
    } as ConsumeMessage);

    await vi.advanceTimersByTimeAsync(1000);
    await importPromise;

    expect(setFailedMock).toHaveBeenCalledWith('Timed out waiting for consumer acknowledgement after 1000ms.');
  });

  it('fails when ack times out', async () => {
    vi.useFakeTimers();
    inputs.queue = 'jobs';
    inputs.require_ack = 'true';
    inputs.ack_timeout = '1000';

    const importPromise = import('./index');

    await vi.waitFor(() => {
      expect(consumeRegistrations).toHaveLength(1);
    });

    await vi.advanceTimersByTimeAsync(1000);
    await importPromise;

    expect(setFailedMock).toHaveBeenCalledWith('Timed out waiting for consumer acknowledgement after 1000ms.');
  });

  it('rejects invalid ack timeout when ack is required', async () => {
    inputs.queue = 'jobs';
    inputs.require_ack = 'true';
    inputs.ack_timeout = '0';

    await import('./index');

    expect(setFailedMock).toHaveBeenCalledWith('ack_timeout must be a positive integer when require_ack is true.');
    expect(connectMock).not.toHaveBeenCalled();
  });
});
