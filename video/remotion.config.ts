import { Config } from '@remotion/cli/config';
import { webpackOverride } from './webpack-override';

Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);
Config.overrideWebpackConfig(webpackOverride);
