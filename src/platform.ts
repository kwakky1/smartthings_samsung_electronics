import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
  UnknownContext,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { AirPurifier } from './device/AirPurifier';
import { AirConditioner } from './device/AirConditioner';
import {
  BearerTokenAuthenticator,
  Device,
  Component,
  CapabilityReference,
  SmartThingsClient,
  DeviceCategory,
} from '@smartthings/core-sdk';
import { DeviceAdapter } from './deviceStatus/deviceAdapter';
import { AirConditionerAdapter } from './deviceStatus/airConditioner';

export class SmartThingsPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic =
    this.api.hap.Characteristic;

  private readonly accessories: PlatformAccessory[] = [];
  private readonly client: SmartThingsClient;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    const token = this.config.token as string;
    this.client = new SmartThingsClient(new BearerTokenAuthenticator(token));

    if (token?.trim()) {
      this.log.debug('Loading devices with token:', token);

      this.api.on('didFinishLaunching', () => {
        this.client.devices
          .list()
          .then((devices: Device[]) => this.handleDevices(devices))
          .catch((err) => log.error('Cannot load devices', err));
      });
    } else {
      this.log.warn('Please congigure your API token and restart homebridge.');
    }
  }

  private handleDevices(devices: Device[]) {
    for (const device of devices) {
      if (device.components) {
        const capabilities = SmartThingsPlatform.getCapabilities(device);
        const categories = SmartThingsPlatform.getCategories(device);
        const missingCapabilities = this.getMissingCapabilities(
          device,
          capabilities,
        ); // 카테고리로 분류, 공기청정기인지 에어컨인지

        const possible = ['AirConditioner', 'AirPurifier'];
        const confirm = categories.filter((categories) =>
          possible.includes(categories),
        );
        if (device.deviceId && confirm.length !== 0) {
          this.log.info('Registering device', device.deviceId);
          this.handleSupportedDevice(device);
        } else {
          this.log.info(
            'Skipping device',
            device.deviceId,
            device.label,
            'Missing categories',
            missingCapabilities,
          );
        }
      }
    }
  }

  private getMissingCapabilities(
    device: Device,
    capabilities: string[],
  ): string[] {

    const categories = SmartThingsPlatform.getCategories(device)[0];
    switch (categories) {
      case 'AirPurifier':
        return AirPurifier.requiredCapabilities.filter(
          (el) => !capabilities.includes(el),
        );
      case 'AirConditioner':
        return AirConditioner.requiredCapabilities.filter(
          (el) => !capabilities.includes(el),
        );
      default:
        return ['out of acceptable categories'];
    }
  }
  // 현재 있는 device 인지 아니면 새로운 device 인지 확인

  private handleSupportedDevice(device: Device) {
    const existingAccessory = this.accessories.find(
      (accessory) => accessory.UUID === device.deviceId,
    );
    if (existingAccessory) {
      this.handleExistingDevice(device, existingAccessory);
    } else {
      this.handleNewDevice(device);
    }
  }

  private static getCapabilities(device: Device) {
    return (
      device.components
        ?.flatMap((component: Component) => {
          return component.capabilities;
        })
        .map(
          (capabilityReference: CapabilityReference) => capabilityReference.id,
        ) ?? []
    );
  }

  private static getCategories(device: Device) {
    return (
      device.components
        ?.flatMap((component: Component) => {
          return component.categories;
        })
        .map((categoryReference: DeviceCategory) => categoryReference.name) ??
      []
    );
  }

  private handleExistingDevice(
    device: Device,
    accessory: PlatformAccessory<UnknownContext>,
  ) {
    this.log.info('Restoring existing accessory from cache:', device.label);
    this.createSmartThingsAccessory(accessory, device);
  }

  private handleNewDevice(device: Device) {
    this.log.info('Adding new accessory:', device.label);
    const accessory = this.createPlatformAccessory(device);

    this.createSmartThingsAccessory(accessory, device);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
      accessory,
    ]);
  }

  private createPlatformAccessory(
    device: Device,
  ): PlatformAccessory<UnknownContext> {
    if (device.label && device.deviceId) {
      const accessory = new this.api.platformAccessory(
        device.label,
        device.deviceId,
      );
      accessory.context.device = device;
      return accessory;
    }

    throw new Error('Missing label and id.');
  }

  private createSmartThingsAccessory(
    accessory: PlatformAccessory<UnknownContext>,
    device: Device,
  ) {
    const categories = SmartThingsPlatform.getCategories(device)[0];

    const airConditionerAdapter = new AirConditionerAdapter(
      device,
      this.log,
      this.client,
    );

    const deviceAdapter = new DeviceAdapter(device, this.log, this.client);
    switch (categories) {
      case 'AirConditioner':
        new AirConditioner(this, accessory, airConditionerAdapter);
        break;
      case 'AirPurifier':
        new AirPurifier(this, accessory, deviceAdapter);
    }
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    this.accessories.push(accessory);
  }
}
