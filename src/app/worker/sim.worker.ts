/// <reference lib="webworker" />
/** The simulation runs off the main thread (plan section 9): the UI only draws. */
import * as Comlink from 'comlink';
import { raceApi } from './race-api';

Comlink.expose(raceApi);
