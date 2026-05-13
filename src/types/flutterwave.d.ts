declare module 'flutterwave-node-v3' {
  class Flutterwave {
    constructor(publicKey: string, secretKey: string);
    [key: string]: any;
  }
  export = Flutterwave;
}
