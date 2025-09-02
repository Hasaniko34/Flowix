const path = require('path');

const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const Dotenv = require('dotenv-webpack');
const EslintWebpackPlugin = require('eslint-webpack-plugin');

module.exports = [{
    mode: 'development',
    context: __dirname,
    entry: {
        app: './src/index.ts'
    },
    output: {
        filename: '[name].js',
        path: path.resolve(__dirname, 'dist'),
        // Needed to compile multi-line strings in Cesium
        sourcePrefix: ''
    },
    devtool: 'eval',
    node: {
        // Resolve node module use of fs
        fs: "empty",
        Buffer: false,
        http: "empty",
        https: "empty",
        zlib: "empty"
    },
    resolve: {
        mainFields: ['module', 'main'],
        extensions: ['.ts', '.tsx', '.js'],
        alias: {
            cesium$: path.resolve(__dirname, 'node_modules/cesium/Source/Cesium.js'),
            cesium: path.resolve(__dirname, 'node_modules/cesium')
        }
    },
    module: {
        rules: [{
            test: /\.css$/,
            use: ['style-loader', 'css-loader']
        }, {
           test: /\.ts$/,
           use: 'ts-loader',
           exclude: /node_modules/,
         }, {
            test: /\.(png|jpg|jpeg|gif|svg|xml)$/,
            use: ['url-loader']
        }, {
            // Strip cesium pragmas
            test: /\.js$/,
            enforce: 'pre',
            include: path.resolve(__dirname, 'node_modules/cesium/Source'),
            use: [{
                loader: 'strip-pragma-loader',
                options: {
                    pragmas: {
                        debug: false
                    }
                }
            }]
        }]
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: 'src/index.html',
            favicon: './src/favicon.png'
        }),
        // Copy Cesium Assets, Widgets, and Workers to a static directory
        new CopyWebpackPlugin({
            patterns: [
                { from: 'node_modules/cesium/Build/Cesium/Workers', to: 'Workers' },
                { from: 'node_modules/cesium/Build/Cesium/ThirdParty', to: 'ThirdParty' },
                { from: 'node_modules/cesium/Build/Cesium/Assets', to: 'Assets' },
                { from: 'node_modules/cesium/Build/Cesium/Widgets', to: 'Widgets' }
            ],
        }),
        new webpack.DefinePlugin({
            // Define relative base path in cesium for loading assets
            CESIUM_BASE_URL: JSON.stringify('')
        }),
        new Dotenv(),
        new EslintWebpackPlugin({
           extensions: ['ts']
        })
    ],

    // development server options
    devServer: {
        contentBase: path.join(__dirname, "dist")
    }
}];