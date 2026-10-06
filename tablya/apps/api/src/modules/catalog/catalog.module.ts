import { Global, Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { KitchenPresenter } from './kitchen.presenter';

@Global()
@Module({ controllers: [CatalogController], providers: [KitchenPresenter], exports: [KitchenPresenter] })
export class CatalogModule {}
