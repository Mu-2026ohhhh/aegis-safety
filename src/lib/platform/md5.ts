function rotl(value: number, shift: number) {
  return (value << shift) | (value >>> (32 - shift));
}

function toWords(bytes: Uint8Array) {
  const words = new Uint32Array(((bytes.length + 8) >>> 6 << 4) + 16);
  for (let i = 0; i < bytes.length; i += 1) words[i >> 2] |= bytes[i] << ((i % 4) * 8);
  words[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8);
  const bits = bytes.length * 8;
  words[words.length - 2] = bits >>> 0;
  words[words.length - 1] = Math.floor(bits / 0x100000000);
  return words;
}

/** MD5 hex digest of a UTF-8 string. Used as the stored content fingerprint. */
export function md5(value: string) {
  const bytes = new TextEncoder().encode(value);
  const words = toWords(bytes);
  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;
  const s = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  for (let i = 0; i < words.length; i += 16) {
    const block = words.subarray(i, i + 16);
    let aa = a;
    let bb = b;
    let cc = c;
    let dd = d;
    for (let j = 0; j < 64; j += 1) {
      let f = 0;
      let g = 0;
      if (j < 16) {
        f = (bb & cc) | (~bb & dd);
        g = j;
      } else if (j < 32) {
        f = (dd & bb) | (~dd & cc);
        g = (5 * j + 1) % 16;
      } else if (j < 48) {
        f = bb ^ cc ^ dd;
        g = (3 * j + 5) % 16;
      } else {
        f = cc ^ (bb | ~dd);
        g = (7 * j) % 16;
      }
      const k = Math.floor(Math.abs(Math.sin(j + 1)) * 0x100000000);
      const next = dd;
      const sum = (aa + f + k + block[g]) >>> 0;
      dd = cc;
      cc = bb;
      bb = (bb + rotl(sum, s[(j >> 4) * 4 + (j % 4)])) >>> 0;
      aa = next;
    }
    a = (a + aa) >>> 0;
    b = (b + bb) >>> 0;
    c = (c + cc) >>> 0;
    d = (d + dd) >>> 0;
  }
  return [a, b, c, d]
    .map((word) => [word & 255, (word >>> 8) & 255, (word >>> 16) & 255, (word >>> 24) & 255])
    .flat()
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
