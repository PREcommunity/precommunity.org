import { Body, Controller, Get, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../common/request-context';
import { config } from '../config';
import { AuthService } from './auth.service';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { NonceRequestDto, VerifySiweDto } from './auth.dto';
import { SessionGuard } from './session.guard';
import { SESSION_COOKIE_NAME, sessionCookieScope } from './session-cookie';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('nonce')
  @UseGuards(AuthRateLimitGuard)
  nonce(@Body() body: NonceRequestDto, @Req() request: Request) {
    const origin =
      request.get('origin') ?? `${request.protocol}://${request.get('host') ?? config.SIWE_DOMAIN}`;
    return this.auth.createNonce(body.address, origin);
  }

  @Post('verify')
  @UseGuards(AuthRateLimitGuard)
  async verify(@Body() body: VerifySiweDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.verify(body.message, body.signature);
    const scope = sessionCookieScope();
    response.cookie(SESSION_COOKIE_NAME, result.sessionToken, {
      ...scope,
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: result.sessionExpiresAt,
    });
    return { user: result.user };
  }

  @UseGuards(SessionGuard)
  @Get('me')
  me(@Req() request: AuthenticatedRequest) {
    return request.principal;
  }

  @Post('logout')
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request.cookies?.[SESSION_COOKIE_NAME] as string | undefined);
    response.clearCookie(SESSION_COOKIE_NAME, sessionCookieScope());
    return { ok: true };
  }
}
