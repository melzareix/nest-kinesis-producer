import { Injectable, Logger } from '@nestjs/common';
import { PutRecordsInput, PutRecordsRequestEntry } from 'aws-sdk/clients/kinesis';

import { Kinesis } from 'aws-sdk';
import { KinesisEvent } from './kinesis-event.interface';

@Injectable()
export class BatchKinesisPublisher {
  private readonly baseLogger: Logger;
  private static readonly ONE_MEG = 1024 * 1024;
  protected entries: PutRecordsRequestEntry[] = [];
  protected streamName: string;
  private payloadSize = 0;
  constructor(protected readonly kinesis: Kinesis) {
    this.baseLogger = new Logger(BatchKinesisPublisher.name);
  }

  async putRecords(streamName: string, events: KinesisEvent[]): Promise<void> {
    this.baseLogger.log(`putRecords() invoked for ${events.length} records on stream ${streamName}`);
    this.streamName = streamName;
    for (const x of events) {
      await this.addEntry({
        Data: x.Data,
        PartitionKey: x.PartitionKey.toString(),
      });
    }
    await this.flush();
    this.baseLogger.log(`putRecords() completed for ${events.length} records`);
  }

  protected async flush(): Promise<void> {
    if (this.entries.length < 1) {
      return;
    }
    const putRecordsInput: PutRecordsInput = {
      StreamName: this.streamName,
      Records: this.entries,
    };
    await this.kinesis.putRecords(putRecordsInput).promise();
    this.entries = [];
  }

  protected async addEntry(entry: PutRecordsRequestEntry): Promise<void> {
    const entryDataSize: number = (<Buffer>entry.Data).length;
    const entryPartitionKeySize = entry.PartitionKey.length;
    if (Number.isNaN(entryDataSize) || Number.isNaN(entryPartitionKeySize)) {
      this.baseLogger.error(
        `Cannot produce data size of partitionKey: ${entry.PartitionKey}  |  Data: ${entry.Data.toString('utf8')}`,
      );
      return;
    }
    if (entryDataSize > BatchKinesisPublisher.ONE_MEG) {
      this.baseLogger.error(
        `FATAL: entry exceeds maximum size of 1M and will not be published, partitionkey: ${entry.PartitionKey}`,
      );
      return;
    }

    const newPayloadSize = this.payloadSize + entryDataSize + entryPartitionKeySize;
    if (newPayloadSize <= 5 * BatchKinesisPublisher.ONE_MEG && this.entries.length < 500) {
      this.payloadSize = newPayloadSize;
      this.entries.push(entry);
    } else {
      await this.flush();
      this.payloadSize = 0;
      await this.addEntry(entry);
    }
  }
}
