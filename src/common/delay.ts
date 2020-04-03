/**
 * Provide a timeout that delays more every time it's accessed.
 */
export class Delay {
  private readonly retryBaseDelay = 1000
  private readonly retryMaxDelay = 10000
  private retryDelay = 0
  private readonly retryDelayFactor = 1.5

  /**
   * The amount to delay. Increases every time it's accessed.
   */
  public get delay(): number {
    const delay = this.retryDelay
    if (this.retryDelay === 0) {
      this.retryDelay = this.retryBaseDelay
    } else {
      this.retryDelay = Math.floor(this.retryDelay * this.retryDelayFactor)
      if (this.retryDelay > this.retryMaxDelay) {
        this.retryDelay = this.retryMaxDelay
      }
    }
    return delay
  }

  /**
   * Reset the delay.
   */
  public reset(): void {
    this.retryDelay = 0
  }
}
