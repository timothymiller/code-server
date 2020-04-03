import * as assert from "assert"
import { Delay } from "../src/common/delay"

describe("Delay", () => {
  const delay = new Delay()

  it("should delay up to a maximum", () => {
    assert.equal(delay.delay, 0)
    assert.equal(delay.delay, 1000)
    assert.equal(delay.delay, 1500)
    assert.equal(delay.delay, 2250)
    assert.equal(delay.delay, 3375)
    assert.equal(delay.delay, 5062)
    assert.equal(delay.delay, 7593)
    assert.equal(delay.delay, 10000)
    assert.equal(delay.delay, 10000)
  })

  it("should reset", () => {
    delay.reset()
    assert.equal(delay.delay, 0)
  })
})
