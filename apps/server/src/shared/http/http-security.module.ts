import { Module } from "@nestjs/common";
import { HttpSecurityController } from "./http-security.controller.js";

@Module({ controllers: [HttpSecurityController] })
export class HttpSecurityModule {}
