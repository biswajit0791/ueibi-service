import { Kafka, logLevel } from 'kafkajs';
import { env } from '../config/env.js';

let kafkaInstance = null;
let producer = null;
let isProducerConnected = false;

export function getKafkaInstance() {
  if (!kafkaInstance) {
    const config = {
      clientId: env.kafkaClientId,
      brokers: env.kafkaBrokers,
      logLevel: logLevel.NOTHING,
      connectionTimeout: 5000,
      retry: {
        initialRetryTime: 100,
        retries: 2,
      },
    };

    if (env.kafkaSsl) {
      config.ssl = true;
    }

    if (env.kafkaSaslUsername && env.kafkaSaslPassword) {
      config.sasl = {
        mechanism: env.kafkaSaslMechanism,
        username: env.kafkaSaslUsername,
        password: env.kafkaSaslPassword,
      };
    }

    kafkaInstance = new Kafka(config);
  }
  return kafkaInstance;
}

export async function initKafkaProducer() {
  if (isProducerConnected && producer) {
    return producer;
  }

  try {
    const k = getKafkaInstance();
    producer = k.producer({
      allowAutoTopicCreation: true,
    });

    await producer.connect();
    isProducerConnected = true;
    console.log(` Apache Kafka: Producer connected [brokers: ${env.kafkaBrokers.join(', ')}]`);
    return producer;
  } catch (err) {
    isProducerConnected = false;
    producer = null;
    console.warn(` [Kafka] Notice: Could not connect producer to brokers (${err.message}). Running with direct write-through.`);
    return null;
  }
}

export function isKafkaProducerReady() {
  return isProducerConnected && producer !== null;
}

export async function publishKafkaEvent(topic, eventType, payload, partitionKey = null) {
  if (!isKafkaProducerReady()) {
    return false;
  }

  try {
    const messageValue = JSON.stringify({
      eventType,
      payload,
      timestamp: new Date().toISOString(),
    });

    await producer.send({
      topic,
      messages: [
        {
          key: partitionKey ? String(partitionKey) : undefined,
          value: messageValue,
          headers: {
            'event-type': eventType,
          },
        },
      ],
    });
    return true;
  } catch (err) {
    console.warn(` [Kafka] Failed to publish ${eventType} to ${topic}: ${err.message}`);
    return false;
  }
}

export async function disconnectKafka() {
  if (producer && isProducerConnected) {
    try {
      await producer.disconnect();
    } catch { /* noop */ }
    isProducerConnected = false;
    producer = null;
  }
}
