export abstract class MpesaServiceContextBase {
  protected abstract readonly logger: Pick<Console, 'log' | 'warn' | 'error'>;
}
