/**
 * 精确有理数：分子分母均为 BigInt，运算全程约分，不使用浮点。
 */

function bigAbs(x: bigint): bigint {
  return x < 0n ? -x : x;
}

export function gcdBig(a: bigint, b: bigint): bigint {
  a = bigAbs(a);
  b = bigAbs(b);
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a === 0n ? 1n : a;
}

export class Rational {
  constructor(
    readonly num: bigint,
    readonly den: bigint = 1n,
  ) {
    if (den === 0n) throw new Error("分母为零");
  }

  static fromInt(n: number | bigint): Rational {
    return new Rational(BigInt(n));
  }

  norm(): Rational {
    if (this.num === 0n) return new Rational(0n, 1n);
    const g = gcdBig(this.num, this.den);
    let num = this.num / g;
    let den = this.den / g;
    if (den < 0n) {
      num = -num;
      den = -den;
    }
    return new Rational(num, den);
  }

  add(o: Rational): Rational {
    return new Rational(this.num * o.den + o.num * this.den, this.den * o.den).norm();
  }

  sub(o: Rational): Rational {
    return new Rational(this.num * o.den - o.num * this.den, this.den * o.den).norm();
  }

  mul(o: Rational): Rational {
    return new Rational(this.num * o.num, this.den * o.den).norm();
  }

  /** 除零返回 null，由调用方跳过该分支 */
  div(o: Rational): Rational | null {
    if (o.num === 0n) return null;
    return new Rational(this.num * o.den, this.den * o.num).norm();
  }

  isZero(): boolean {
    return this.num === 0n;
  }

  equals(o: Rational): boolean {
    const a = this.norm();
    const b = o.norm();
    return a.num === b.num && a.den === b.den;
  }

  /** 人类可读精确分数，例如 8/3、-5、0 */
  toFractionString(): string {
    const r = this.norm();
    if (r.den === 1n) return r.num.toString();
    return `${r.num}/${r.den}`;
  }
}
