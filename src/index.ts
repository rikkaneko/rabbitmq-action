import * as core from '@actions/core';
import amqp from 'amqplib';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Channel, RecoveringChannelModel, ConsumeMessage } from 'amqplib';

interface RawActionInputs {
  amqpUrl: string;
  amqpUsername: string;
  amqpPassword: string;
  amqpCertChain: string;
  amqpCertKey: string;
  amqpCertCa: string;
  exchange: string;
  queue: string;
  routeKey: string;
  header: string;
  payload: string;
  requireAck: string;
  ackTimeout: string;
}

interface ActionInputs {
  amqpUrl: string;
  amqpUsername?: string;
  amqpPassword?: string;
  amqpCertChain?: string;
  amqpCertKey?: string;
  amqpCertCa?: string;
  exchange?: string;
  queue?: string;
  routeKey: string;
  headers: Record<string, string>;
  payload: string;
  requireAck: boolean;
  ackTimeout?: number;
}

interface PublishTarget {
  exchange: string;
  routingKey: string;
}

const rawInputSchema = z.object({
  amqpUrl: z.string().trim().min(1, 'amqp_url is required'),
  amqpUsername: z.string().trim(),
  amqpPassword: z.string(),
  amqpCertChain: z.string(),
  amqpCertKey: z.string(),
  amqpCertCa: z.string(),
  exchange: z.string().trim(),
  queue: z.string().trim(),
  routeKey: z.string(),
  header: z.string(),
  payload: z.string().trim().min(1, 'payload is required'),
  requireAck: z.string().trim(),
  ackTimeout: z.string().trim(),
});

async function run(): Promise<void> {
  let connection: RecoveringChannelModel | undefined;
  let channel: Channel | undefined;
  let ackTimeoutHandle: NodeJS.Timeout | undefined;
  let ackConsumerTag = '';

  try {
    const rawInputs: RawActionInputs = {
      amqpUrl: core.getInput('amqp_url', { required: true }),
      amqpUsername: core.getInput('amqp_username'),
      amqpPassword: core.getInput('amqp_password'),
      amqpCertChain: core.getInput('amqp_cert_chain'),
      amqpCertKey: core.getInput('amqp_cert_key'),
      amqpCertCa: core.getInput('amqp_cert_ca'),
      exchange: core.getInput('exchange'),
      queue: core.getInput('queue'),
      routeKey: core.getInput('route_key'),
      header: core.getInput('header'),
      payload: core.getInput('payload', { required: true }),
      requireAck: core.getInput('require_ack') || 'false',
      ackTimeout: core.getInput('ack_timeout'),
    };

    for (const secret of [rawInputs.amqpPassword, rawInputs.amqpCertChain, rawInputs.amqpCertKey, rawInputs.amqpCertCa]) {
      if (secret) {
        core.setSecret(secret);
      }
    }

    const parsedRawInputs = rawInputSchema.parse(rawInputs);
    let requireAck = false;

    if (parsedRawInputs.requireAck === 'true') {
      requireAck = true;
    } else if (parsedRawInputs.requireAck !== 'false') {
      throw new Error('require_ack must be "true" or "false".');
    }

    const ackTimeout = parsedRawInputs.ackTimeout ? Number(parsedRawInputs.ackTimeout) : undefined;
    const headers: Record<string, string> = {};

    for (const line of parsedRawInputs.header.split('\n')) {
      const trimmedLine = line.trim();

      if (!trimmedLine) {
        continue;
      }

      const separatorIndex = trimmedLine.indexOf('=');

      if (separatorIndex <= 0) {
        throw new Error(`Invalid header line "${trimmedLine}". Expected key=value.`);
      }

      headers[trimmedLine.slice(0, separatorIndex).trim()] = trimmedLine.slice(separatorIndex + 1).trim();
    }

    if (parsedRawInputs.queue && parsedRawInputs.exchange) {
      throw new Error('Provide either queue or exchange, not both.');
    }

    if (!parsedRawInputs.queue && !parsedRawInputs.exchange) {
      throw new Error('Provide queue or exchange.');
    }

    if (requireAck && (!ackTimeout || !Number.isInteger(ackTimeout) || ackTimeout <= 0)) {
      throw new Error('ack_timeout must be a positive integer when require_ack is true.');
    }

    if (!requireAck && parsedRawInputs.ackTimeout) {
      throw new Error('ack_timeout is only applicable when require_ack is true.');
    }

    const inputs: ActionInputs = {
      amqpUrl: parsedRawInputs.amqpUrl,
      amqpUsername: parsedRawInputs.amqpUsername || undefined,
      amqpPassword: parsedRawInputs.amqpPassword || undefined,
      amqpCertChain: parsedRawInputs.amqpCertChain || undefined,
      amqpCertKey: parsedRawInputs.amqpCertKey || undefined,
      amqpCertCa: parsedRawInputs.amqpCertCa || undefined,
      exchange: parsedRawInputs.exchange || undefined,
      queue: parsedRawInputs.queue || undefined,
      routeKey: parsedRawInputs.routeKey,
      headers,
      payload: parsedRawInputs.payload,
      requireAck,
      ackTimeout,
    };
    const target: PublishTarget = inputs.queue
      ? { exchange: '', routingKey: inputs.queue }
      : { exchange: inputs.exchange ?? '', routingKey: inputs.routeKey };
    let connectionOptions: any = {};

    core.info(`Publishing payload to ${inputs.queue ? 'queue' : 'exchange'} target.`);

    if (inputs.amqpCertChain && inputs.amqpCertKey && inputs.amqpCertCa) {
      core.info('[amqp] Using mTLS authentication.');
      connectionOptions = {
        cert: Buffer.from(inputs.amqpCertChain, 'utf8'),
        key: Buffer.from(inputs.amqpCertKey, 'utf8'),
        ca: [Buffer.from(inputs.amqpCertCa, 'utf8')],
        rejectUnauthorized: true,
        credentials: amqp.credentials.external(),
      };
    } else if (inputs.amqpUsername && inputs.amqpPassword) {
      core.info('[amqp] Using username/password authentication.');
      connectionOptions = {
        credentials: amqp.credentials.plain(inputs.amqpUsername, inputs.amqpPassword),
      };
    }

    connection = await amqp.connect(inputs.amqpUrl, connectionOptions);
    channel = await connection.createChannel();

    let ackPromise: Promise<void> | undefined;
    let correlationId: string | undefined;

    if (inputs.requireAck) {
      correlationId = randomUUID();
      let ackResolve: (() => void) | undefined;
      let ackReject: ((reason: Error) => void) | undefined;

      ackPromise = new Promise<void>((resolve, reject) => {
        ackResolve = resolve;
        ackReject = reject;
      });

      ackTimeoutHandle = setTimeout(() => {
        ackReject?.(new Error(`Timed out waiting for consumer acknowledgement after ${inputs.ackTimeout}ms.`));
      }, inputs.ackTimeout);

      const reply = await channel.consume(
        'amq.rabbitmq.reply-to',
        (message: ConsumeMessage | null) => {
          if (!message || message.properties.correlationId !== correlationId) {
            return;
          }

          if (ackTimeoutHandle) {
            clearTimeout(ackTimeoutHandle);
          }

          ackResolve?.();
        },
        { noAck: true }
      );
      ackConsumerTag = reply.consumerTag;
    }

    channel.publish(target.exchange, target.routingKey, Buffer.from(inputs.payload, 'utf8'), {
      headers: inputs.headers,
      contentType: 'text/plain',
      deliveryMode: 2,
      correlationId,
      replyTo: ackPromise ? 'amq.rabbitmq.reply-to' : undefined,
    });

    if (ackPromise) {
      await ackPromise;
    }

    core.info(`[amqp] Published payload to ${inputs.exchange ?? inputs.queue ?? inputs.amqpUrl}.`);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  } finally {
    if (ackTimeoutHandle) {
      clearTimeout(ackTimeoutHandle);
    }

    if (channel && ackConsumerTag) {
      await channel.cancel(ackConsumerTag);
    }

    if (channel) {
      await channel.close();
    }

    if (connection) {
      await connection.close();
    }
  }
}

void (async (): Promise<void> => {
  await run();
})();
