// 精确有理数：分子分母均为 BigInt，始终保持约分且分母为正。
// 全程不使用浮点数，因此不会出现 23.9999999 被误判为 24 的情况。

export class Fraction {
  readonly num: bigint;
  readonly den: bigint;

  private constructor(num: bigint, den: bigint) {
    this.num = num;
    this.den = den;
  }

  static fromInt(value: number | bigint): Fraction {
    return new Fraction(BigInt(value), 1n);
  }

  static make(num: bigint, den: bigint): Fraction {
    if (den === 0n) {
      throw new ZeroDivisionError();
    }
    if (num === 0n) {
      return new Fraction(0n, 1n);
    }
    let n = num;
    let d = den;
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = bigIntGcd(n < 0n ? -n : n, d);
    return new Fraction(n / g, d / g);
  }

  add(other: Fraction): Fraction {
    return Fraction.make(
      this.num * other.den + other.num * this.den,
      this.den * other.den,
    );
  }

  sub(other: Fraction): Fraction {
    return Fraction.make(
      this.num * other.den - other.num * this.den,
      this.den * other.den,
    );
  }

  mul(other: Fraction): Fraction {
    return Fraction.make(this.num * other.num, this.den * other.den);
  }

  div(other: Fraction): Fraction {
    if (other.num === 0n) {
      throw new ZeroDivisionError();
    }
    return Fraction.make(this.num * other.den, this.den * other.num);
  }

  isZero(): boolean {
    return this.num === 0n;
  }

  equals(other: Fraction): boolean {
    return this.num === other.num && this.den === other.den;
  }

  toDecimalString(): string {
    const sign = this.num < 0n ? "-" : "";
    const n = this.num < 0n ? -this.num : this.num;
    const whole = n / this.den;
    const rem = n % this.den;
    if (rem === 0n) {
      return `${sign}${whole}`;
    }
    return `${sign}${whole} + ${rem}/${this.den}`;
  }

  toString(): string {
    if (this.den === 1n) {
      return `${this.num}`;
    }
    return `${this.num}/${this.den}`;
  }
}

export class ZeroDivisionError extends Error {
  constructor() {
    super("除数为零");
    this.name = "ZeroDivisionError";
  }
}

export function bigIntGcd(a: bigint, b: bigint): bigint {
  let x = a;
  let y = b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x === 0n ? 1n : x;
}
