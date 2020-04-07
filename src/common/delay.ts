/**
 * Provide a timeout that delays more every time it's accessed.
 */
export class Delay {
  private readonly retryBaseDelay = 1000
  private readonly retryMaxDelay = 10000
  private retryDelay = 0
  private readonly retryDelayFactor = 1.5

  // The thing must be up for at least this long to be considered actually up.
  // Resolves issues with things that connect but then fail shortly after.
  private resetDelay = 1000
  private resetTimeout?: NodeJS.Timeout

  /**
   * The amount to delay. Increases every time it's accessed.
   */
  public get delay(): number {
    if (typeof this.resetTimeout !== "undefined") {
      clearTimeout(this.resetTimeout)
    }
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
   * Reset the delay after a timeout.
   */
  public reset(): void {
    if (typeof this.resetTimeout !== "undefined") {
      clearTimeout(this.resetTimeout)
    }
    this.resetTimeout = setTimeout(() => {
      this.retryDelay = 0
    }, this.resetDelay)
  }
}
