#!/usr/bin/env bash
set -e

PROTOCOL_DIR=$(pwd)
sudo chmod -R a+rwx /usr/local/lib/node_modules


run_slither() {
    cd $1
    mkdir -p node_modules/
    cp -r ../node_modules/@openzeppelin ./node_modules/@openzeppelin

    cd $PROTOCOL_DIR

    # print out slither version for debugging
    slither --version
    slither --exclude=divide-before-multiply,locked-ether,unused-return,timestamp,naming-convention,pragma,solc-version,external-function,reentrancy-benign,reentrancy-no-eth,arbitrary-send,incorrect-equality,reentrancy-events,assembly --filter-paths="@openzeppelin|WETH9.sol" $1
}

run_slither $PROTOCOL_DIR/core
