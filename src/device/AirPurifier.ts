import {
  AccessoryPlugin,
  CharacteristicValue,
  PlatformAccessory,
  Service,
} from 'homebridge';
import { SmartThingsPlatform } from '../platform';
import {
  DeviceAdapter,
  PlatformStatusInfo,
} from '../deviceStatus/deviceAdapter';
import { Device } from '@smartthings/core-sdk';
import { isDefined } from '../utils';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */

const defaultUpdateInterval = 15;

export class AirPurifier implements AccessoryPlugin {
  private airPurifierService?: Service;
  private accessoryInformationService?: Service;
  private airQualitySensorService?: Service;
  private device: Device;
  private deviceStatus: PlatformStatusInfo;
  public static readonly requiredCapabilities = ['switch', 'airQualitySensor'];

  constructor(
    private readonly platform: SmartThingsPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly deviceAdapter: DeviceAdapter,
  ) {
    this.device = accessory.context.device as Device;
    this.deviceStatus = {
      active: false,
      airQuality: 0,
      mode: 'smart',
    };

    const {
      Service: { AirPurifier, AirQualitySensor },
      Characteristic,
    } = this.platform;

    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(
        this.platform.Characteristic.Manufacturer,
        this.device.manufacturerName ?? 'unknown',
      )
      .setCharacteristic(
        this.platform.Characteristic.Model,
        this.device.name ?? 'unknown',
      )
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        this.device.presentationId ?? 'unknown',
      );

    this.airPurifierService =
      this.accessory.getService(AirPurifier) ||
      this.accessory.addService(AirPurifier);

    this.airQualitySensorService =
      this.accessory.getService(AirQualitySensor) ||
      this.accessory.addService(AirQualitySensor);

    this.accessoryInformationService?.setCharacteristic(
      this.platform.Characteristic.Name,
      this.device.label ?? 'unkown',
    );
    this.airPurifierService
      ?.getCharacteristic(Characteristic.Active)
      .onSet(this.setActive.bind(this))
      .onGet(this.getActive.bind(this));

    this.airPurifierService
      ?.getCharacteristic(Characteristic.CurrentAirPurifierState)
      .onGet(this.handleCurrentAirPurifierState.bind(this));

    this.airPurifierService
      ?.getCharacteristic(Characteristic.TargetAirPurifierState)
      .onGet(async () => {
        if (this.deviceStatus.mode === 'smart') {
          return Characteristic.TargetAirPurifierState.AUTO;
        } else {
          return Characteristic.TargetAirPurifierState.MANUAL;
        }
      })
      .onSet(async (updateValue) => {
        return updateValue;
      });

    this.airQualitySensorService
      ?.getCharacteristic(Characteristic.AirQuality)
      .onGet(this.getAirQuality.bind(this));

    const updateInterval =
      this.platform.config.updateInterval ?? defaultUpdateInterval;
    this.platform.log.info('Update status every', updateInterval, 'secs');

    this.updateStatus();

    setInterval(async () => {
      await this.updateStatus();
    }, updateInterval * 1000);
  }

  private getActive(): CharacteristicValue {
    return this.deviceStatus.active;
  }

  private async setActive(newState: CharacteristicValue) {
    const isActive = newState === 1;
    try {
      await this.executeCommand(isActive ? 'on' : 'off', 'switch');
      this.deviceStatus.active = isActive;
    } catch (err) {
      this.platform.log.error('Can not device Active', err);
      await this.updateStatus();
    }
  }

  private handleCurrentAirPurifierState(): CharacteristicValue {
    if (this.deviceStatus.active) {
      return this.platform.Characteristic.CurrentAirPurifierState.PURIFYING_AIR;
    } else {
      return this.platform.Characteristic.CurrentAirPurifierState.INACTIVE;
    }
  }

  private getAirQuality(): CharacteristicValue {
    return AirPurifier.checkAirQuality(this.deviceStatus.airQuality);
  }

  private static checkAirQuality(state: number): CharacteristicValue {
    if (state <= 1) {
      return 1; // Return EXCELLENT
    } else if (state > 1 && state <= 2) {
      return 2; // Return GOOD
    } else if (state > 2 && state <= 3) {
      return 3; // Return FAIR
    } else if (state > 3 && state <= 4) {
      return 4; // Return INFERIOR
    } else if (state > 4) {
      return 5; // Return POOR (Homekit only goes to cat 5, so the last two AQI cats of Very Unhealty and Hazardous.
    } else {
      return 0; // Error or unknown response.
    }
  }

  private async updateStatus() {
    try {
      this.deviceStatus = await this.getStatus();
    } catch (error: unknown) {
      this.platform.log.error(
        'Error while fetching device status: ' +
          AirPurifier.getErrorMessage(error),
      );
      this.platform.log.debug('Caught error', error);
    }
  }

  private static getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private async executeCommand(
    command: string,
    capability: string,
    commandArguments?: (string | number)[],
  ) {
    await this.deviceAdapter.executeMainCommand(
      command,
      capability,
      commandArguments,
    );
  }

  private getStatus(): Promise<PlatformStatusInfo> {
    return this.deviceAdapter.getStatus();
  }

  getServices(): Service[] {
    return [
      this.airPurifierService,
      this.airQualitySensorService,
      this.accessoryInformationService,
    ].filter(isDefined);
  }
}
