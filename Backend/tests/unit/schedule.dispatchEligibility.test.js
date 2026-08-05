const dispatchService = require('../../services/dispatch.service');
const rideModel = require('../../models/ride.model');
const { createCaptain } = require('../factories/captain.factory');
const { createUser } = require('../factories/user.factory');

describe('Agendamento — elegibilidade do motorista', () => {
    it('exclui motorista ocupado e categoria incompatível do conjunto ofertado', async () => {
        const user = await createUser();
        const busyCaptain = await createCaptain({
            vehicle: { color: 'black', plate: 'BUS1234', capacity: 4, vehicleType: 'car' },
        });
        const idleCaptain = await createCaptain({
            vehicle: { color: 'white', plate: 'IDL1234', capacity: 4, vehicleType: 'car' },
        });
        const motoCaptain = await createCaptain({
            vehicle: { color: 'red', plate: 'MOT1234', capacity: 2, vehicleType: 'moto' },
        });

        await rideModel.create({
            user: user._id,
            captain: busyCaptain._id,
            pickup: 'Rua A',
            destination: 'Rua B',
            fare: 20,
            vehicleType: 'car',
            otp: '123456',
            status: 'accepted',
        });

        const categoryMatches = dispatchService.filterCaptainsByVehicleType(
            [busyCaptain, idleCaptain, motoCaptain],
            'car'
        );
        const eligible = await dispatchService.filterCaptainsWithoutActiveWork(categoryMatches, {
            excludeActiveRide: true,
            excludeActiveParcel: true,
        });

        expect(eligible.map((captain) => captain._id.toString())).toEqual([idleCaptain._id.toString()]);
    });
});
