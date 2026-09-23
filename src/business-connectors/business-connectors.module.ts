import { Module } from '@nestjs/common';
import { LogistiGAConnector } from './logistiga.connector.js';
import { PistonConnector } from './piston.connector.js';

@Module({
  providers: [LogistiGAConnector, PistonConnector],
  exports: [LogistiGAConnector, PistonConnector],
})
export class BusinessConnectorsModule {}
