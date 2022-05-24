import {
  ComponentStatus,
  Device,
  DeviceStatus,
  SmartThingsClient,
} from '@smartthings/core-sdk';
import { Logger } from 'homebridge';

export interface PlatformStatusInfo {
  active: boolean;
  airQuality: number;
  mode: string;
}

export class DeviceAdapter {
  constructor(
    private readonly device: Device,
    private readonly log: Logger,
    private readonly client: SmartThingsClient,
  ) {}

  async getStatus(): Promise<PlatformStatusInfo> {
    const mainComponent = await this.getMainComponent();
    return {
      active: mainComponent?.['switch']?.['switch']?.['value'] === 'on',
      airQuality: mainComponent?.['airQualitySensor']?.['airQuality']?.[
        'value'
      ] as number,
      mode: mainComponent?.['fanMode']?.['value'] as string,
    };
  }

  private async getMainComponent(): Promise<ComponentStatus> {
    const status = await this.getDeviceStatus();
    if (!status.components) {
      throw Error('Cannot get device status');
    }
    return status.components['main'];
  }

  private getDeviceStatus(): Promise<DeviceStatus> {
    if (!this.device.deviceId) {
      throw new Error('Device id must be set.');
    }
    this.log.debug('Get status for device', this.device.deviceId);
    return this.client.devices.getStatus(this.device.deviceId);
  }

  public async executeMainCommand(
    command: string,
    capability: string,
    commandArguments?: (string | number)[],
  ) {
    if (!this.device.deviceId) {
      throw Error('Device ID must be set');
    }

    this.log.debug('Executing command', capability, command);
    const status = await this.client.devices.executeCommand(
      this.device.deviceId,
      {
        component: 'main',
        command: command,
        capability: capability,
        arguments: commandArguments,
      },
    );

    return status.results.map((result) => {
      if (result.status === 'FAILED') {
        throw Error('Command failed with status ' + result.status);
      } else {
        return this.log.debug(result.status);
      }
    });
  }
}
