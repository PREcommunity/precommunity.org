import { CanActivate, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ApplicationFeaturesService } from './application-features.service';

@Injectable()
export class KeywordMarketEnabledGuard implements CanActivate {
  constructor(
    @Inject(ApplicationFeaturesService) private readonly features: ApplicationFeaturesService,
  ) {}

  async canActivate() {
    const features = await this.features.get();
    if (!features.keywordMarketEnabled) {
      throw new NotFoundException('Keyword Market is unavailable');
    }
    return true;
  }
}
