export interface KinesisEvent {
  PartitionKey: string;
  Data: Buffer;
}
