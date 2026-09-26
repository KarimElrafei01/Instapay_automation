import { Global, Module } from "@nestjs/common";
import { DATA_ENCRYPTOR, EnvironmentAesGcmDataEncryptor } from "./data-encryptor.js";

@Global()
@Module({
  providers: [{ provide: DATA_ENCRYPTOR, useFactory: () => new EnvironmentAesGcmDataEncryptor() }],
  exports: [DATA_ENCRYPTOR],
})
export class CryptoModule {}
