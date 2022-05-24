import {
  AccessoryPlugin,
  CharacteristicValue,
  PlatformAccessory,
  Service,
} from 'homebridge';
import { SmartThingsPlatform } from '../platform';
import {
  AirConditionerAdapter,
  AirConditionerStatusInfo,
} from '../deviceStatus/airConditioner';
import { Device } from '@smartthings/core-sdk';
import { isDefined } from '../utils';
import { TargetHeaterCoolerState } from 'hap-nodejs/dist/lib/definitions';

const defaultUpdateInterval = 15;
const defaultMinTemperature = 16;
const defaultMaxTemperature = 30;

export class AirConditioner implements AccessoryPlugin {
  private airConditionerService?: Service;
  private accessoryInformationService?: Service;
  private device: Device;
  private deviceStatus: AirConditionerStatusInfo;
  public static readonly requiredCapabilities = [
    'switch',
    'temperatureMeasurement',
    'thermostatCoolingSetpoint',
  ];

  constructor(
    private readonly platform: SmartThingsPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly deviceAdapter: AirConditionerAdapter,
  ) {
    this.device = accessory.context.device as Device;
    this.deviceStatus = {
      mode: 'auto',
      active: false,
      currentTemperature:
        this.platform.config.minTemperature ?? defaultMinTemperature,
      targetTemperature:
        this.platform.config.maxTemperature ?? defaultMaxTemperature,
    };

    const {
      Service: { HeaterCooler },
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

    this.airConditionerService =
      this.accessory.getService(HeaterCooler) ||
      this.accessory.addService(HeaterCooler);

    this.accessoryInformationService?.setCharacteristic(
      this.platform.Characteristic.Name,
      this.device.label ?? 'unkown',
    );

    const temperatureProperties = {
      maxValue: this.platform.config.maxTemperature ?? defaultMaxTemperature,
      minValue: this.platform.config.minTemperature ?? defaultMinTemperature,
      minStep: 1,
    };

    this.airConditionerService
      ?.getCharacteristic(Characteristic.Active)
      .onSet(this.setActive.bind(this))
      .onGet(this.getActive.bind(this));

    this.airConditionerService
      .getCharacteristic(
        this.platform.Characteristic.HeatingThresholdTemperature,
      )
      .setProps(temperatureProperties)
      .onGet(this.getCoolingTemperature.bind(this))
      .onSet(this.setCoolingTemperature.bind(this));

    this.airConditionerService
      .getCharacteristic(
        this.platform.Characteristic.CoolingThresholdTemperature,
      )
      .setProps(temperatureProperties)
      .onGet(this.getCoolingTemperature.bind(this))
      .onSet(this.setCoolingTemperature.bind(this));

    this.airConditionerService
      .getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
      .onGet(this.getHeaterCoolerState.bind(this))
      .onSet(this.setHeaterCoolerState.bind(this));

    this.airConditionerService
      ?.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
      .onGet(this.handleCurrentAirPurifierState.bind(this));

    this.airConditionerService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(this.handleCurrentTemp.bind(this));

    // 에어컨에 공기질센서 사용시
    /*this.airPurifierService
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
      });*/

    // 에어컨에 공기질센서 사용시
    /*this.airQualitySensorService
      ?.getCharacteristic(Characteristic.AirQuality)
      .onGet(this.getAirQuality.bind(this));*/

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

  private getCoolingTemperature(): CharacteristicValue {
    return this.deviceStatus.targetTemperature;
  }

  private getHeaterCoolerState(): CharacteristicValue {
    return this.fromSmartThingsMode(this.deviceStatus.mode);
  }

  private async setCoolingTemperature(value: CharacteristicValue) {
    const targetTemperature = value as number;

    try {
      await this.executeCommand(
        'setCoolingSetpoint',
        'thermostatCoolingSetpoint',
        [targetTemperature],
      );
      this.deviceStatus.targetTemperature = targetTemperature;
    } catch (error) {
      this.platform.log.error('Cannot set device temperature', error);
      await this.updateStatus();
    }
  }

  private async setHeaterCoolerState(value: CharacteristicValue) {
    const mode = this.toSmartThingsMode(value);

    try {
      await this.executeCommand('setAirConditionerMode', 'airConditionerMode', [
        mode,
      ]);
      this.deviceStatus.mode = mode;
    } catch (error) {
      this.platform.log.error('Cannot set device mode', error);
      await this.updateStatus();
    }
  }

  private handleCurrentAirPurifierState(): CharacteristicValue {
    if (this.deviceStatus.active) {
      return this.platform.Characteristic.CurrentHeaterCoolerState.COOLING;
    } else {
      return this.platform.Characteristic.CurrentAirPurifierState.INACTIVE;
    }
  }

  private handleCurrentTemp(): CharacteristicValue {
    return this.deviceStatus.currentTemperature;
  }

  /*private getAirQuality(): CharacteristicValue {
    return AirConditioner.checkAirQuality(this.deviceStatus.airQuality);
  }*/

  private toSmartThingsMode(value: CharacteristicValue): string {
    switch (value) {
      case TargetHeaterCoolerState.HEAT:
        return 'heat';
      case TargetHeaterCoolerState.COOL:
        return 'cool';
      case TargetHeaterCoolerState.AUTO:
        return 'auto';
    }

    this.platform.log.warn('Illegal heater-cooler state', value);
    return 'auto';
  }

  private fromSmartThingsMode(state: string): CharacteristicValue {
    switch (state) {
      case 'cool':
        return TargetHeaterCoolerState.COOL;
      case 'auto':
        return TargetHeaterCoolerState.AUTO;
      case 'heat':
        return TargetHeaterCoolerState.HEAT;
    }

    this.platform.log.warn('Received unknown heater-cooler state', state);
    return TargetHeaterCoolerState.AUTO;
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
          AirConditioner.getErrorMessage(error),
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

  private getStatus(): Promise<AirConditionerStatusInfo> {
    return this.deviceAdapter.getStatus();
  }

  getServices(): Service[] {
    return [
      this.airConditionerService,
      this.accessoryInformationService,
    ].filter(isDefined);
  }
}
