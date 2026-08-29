import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/request-context';
import { AuthService } from './auth.service';
import { SESSION_COOKIE_NAME } from './session-cookie';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
    if (!token) throw new UnauthorizedException('Connect a wallet to continue');
    request.principal = await this.auth.authenticate(token);
    return true;
  }
}
