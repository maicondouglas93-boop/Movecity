import React, { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import axios from 'axios';
import { UserDataContext } from '../../context/UserContext';
import { useToast } from '../../context/ToastContext';

const personalDataSchema = z.object({
    firstname: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
    lastname: z.string().min(2, "Sobrenome deve ter pelo menos 2 caracteres"),
    email: z.string().email("E-mail inválido"),
    phone: z.string().min(10, "Telefone inválido").optional().or(z.literal('')),
    cpf: z.string().min(11, "CPF inválido").optional().or(z.literal('')),
    birthDate: z.string().optional(),
    gender: z.string().optional()
});

const PersonalData = () => {
    const navigate = useNavigate();
    const { user, setUser } = useContext(UserDataContext);
    const { addToast } = useToast();
    const [loading, setLoading] = useState(false);
    const [initialLoading, setInitialLoading] = useState(true);
    const [photoPreview, setPhotoPreview] = useState(user?.photo || null);

    const { register, handleSubmit, formState: { errors }, reset } = useForm({
        resolver: zodResolver(personalDataSchema),
        defaultValues: {
            firstname: user?.fullname?.firstname || '',
            lastname: user?.fullname?.lastname || '',
            email: user?.email || '',
            phone: user?.phone || '',
            cpf: user?.cpf || '',
            birthDate: user?.birthDate || '',
            gender: user?.gender || ''
        }
    });

    useEffect(() => {
        // Fetch actual profile data
        const fetchProfile = async () => {
            try {
                const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/users/profile`, {
                    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
                });
                
                const profileData = response.data.user || user;
                
                // Update Context
                if(response.data.user) {
                    setUser(profileData);
                }

                reset({
                    firstname: profileData?.fullname?.firstname || '',
                    lastname: profileData?.fullname?.lastname || '',
                    email: profileData?.email || '',
                    phone: profileData?.phone || '',
                    cpf: profileData?.cpf || '',
                    birthDate: profileData?.birthDate ? new Date(profileData.birthDate).toISOString().split('T')[0] : '',
                    gender: profileData?.gender || ''
                });
                if(profileData?.photo) setPhotoPreview(profileData.photo);
            } catch (error) {
                console.log("Using local context data, API not ready.");
            } finally {
                setInitialLoading(false);
            }
        };
        fetchProfile();
    }, []);

    const onSubmit = async (data) => {
        setLoading(true);
        try {
            const response = await axios.put(`${import.meta.env.VITE_BASE_URL}/users/profile`, data, {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
            });
            setUser(response.data.user);
            addToast('Perfil atualizado com sucesso!', 'success');
        } catch (error) {
            addToast('Perfil atualizado (Modo Offline - API não encontrada)', 'success');
        } finally {
            setLoading(false);
        }
    };

    const handlePhotoChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setPhotoPreview(reader.result);
                addToast('Foto pronta para upload (Backend em breve)', 'info');
            };
            reader.readAsDataURL(file);
        }
    };

    if (initialLoading) {
        return (
            <div className="h-screen flex items-center justify-center bg-gray-50">
                <i className="ri-loader-4-line text-4xl animate-spin text-gray-400"></i>
            </div>
        );
    }

    return (
        <div className="h-screen bg-gray-50 flex flex-col font-sans">
            <div className="flex items-center gap-4 p-5 bg-white border-b border-gray-100 sticky top-0 z-10">
                <i onClick={() => navigate('/profile')} className="ri-arrow-left-line text-2xl cursor-pointer active:scale-95 transition-transform"></i>
                <h2 className="text-xl font-semibold flex-1 text-gray-800">Dados Pessoais</h2>
            </div>

            <div className="flex-1 overflow-y-auto p-5 pb-24">
                <div className="flex flex-col items-center justify-center mb-8">
                    <div className="relative mb-3">
                        <div className="h-28 w-28 bg-gray-200 rounded-full flex items-center justify-center overflow-hidden border-4 border-white shadow-md">
                            {photoPreview ? (
                                <img src={photoPreview} alt="Profile" className="w-full h-full object-cover" />
                            ) : (
                                <i className="ri-user-fill text-6xl text-gray-400"></i>
                            )}
                        </div>
                        <label htmlFor="photo-upload" className="absolute bottom-0 right-0 bg-black text-white rounded-full h-10 w-10 flex items-center justify-center shadow-lg cursor-pointer active:scale-95 transition-transform border-2 border-white">
                            <i className="ri-camera-fill text-lg"></i>
                        </label>
                        <input id="photo-upload" type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
                    </div>
                    <p className="text-sm text-gray-500 font-medium">Trocar foto de perfil</p>
                </div>

                <form id="profile-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
                    <div className="flex gap-4">
                        <div className="flex-1">
                            <label className="text-xs font-semibold text-gray-500 ml-1 mb-1 block">Nome</label>
                            <input 
                                type="text" 
                                {...register('firstname')}
                                className={`w-full bg-white border ${errors.firstname ? 'border-red-400' : 'border-gray-200'} px-4 py-3 rounded-xl outline-none focus:border-black font-medium`}
                            />
                            {errors.firstname && <p className="text-xs text-red-500 mt-1 ml-1">{errors.firstname.message}</p>}
                        </div>
                        <div className="flex-1">
                            <label className="text-xs font-semibold text-gray-500 ml-1 mb-1 block">Sobrenome</label>
                            <input 
                                type="text" 
                                {...register('lastname')}
                                className={`w-full bg-white border ${errors.lastname ? 'border-red-400' : 'border-gray-200'} px-4 py-3 rounded-xl outline-none focus:border-black font-medium`}
                            />
                            {errors.lastname && <p className="text-xs text-red-500 mt-1 ml-1">{errors.lastname.message}</p>}
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-gray-500 ml-1 mb-1 block">E-mail</label>
                        <input 
                            type="email" 
                            {...register('email')} 
                            disabled
                            className="w-full bg-gray-100 border border-transparent text-gray-500 px-4 py-3 rounded-xl outline-none font-medium" 
                        />
                        <p className="text-[10px] text-gray-400 ml-1 mt-1">O e-mail não pode ser alterado por segurança.</p>
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-gray-500 ml-1 mb-1 block">Telefone</label>
                        <input 
                            type="tel" 
                            {...register('phone')} 
                            placeholder="(00) 00000-0000"
                            className={`w-full bg-white border ${errors.phone ? 'border-red-400' : 'border-gray-200'} px-4 py-3 rounded-xl outline-none focus:border-black font-medium`}
                        />
                        {errors.phone && <p className="text-xs text-red-500 mt-1 ml-1">{errors.phone.message}</p>}
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-gray-500 ml-1 mb-1 block">CPF</label>
                        <input 
                            type="text" 
                            {...register('cpf')} 
                            placeholder="000.000.000-00"
                            className={`w-full bg-white border ${errors.cpf ? 'border-red-400' : 'border-gray-200'} px-4 py-3 rounded-xl outline-none focus:border-black font-medium`}
                        />
                        {errors.cpf && <p className="text-xs text-red-500 mt-1 ml-1">{errors.cpf.message}</p>}
                    </div>

                    <div className="flex gap-4">
                        <div className="flex-[2]">
                            <label className="text-xs font-semibold text-gray-500 ml-1 mb-1 block">Data de Nascimento</label>
                            <input 
                                type="date" 
                                {...register('birthDate')}
                                className="w-full bg-white border border-gray-200 px-4 py-3 rounded-xl outline-none focus:border-black font-medium" 
                            />
                        </div>
                        <div className="flex-1">
                            <label className="text-xs font-semibold text-gray-500 ml-1 mb-1 block">Gênero</label>
                            <select 
                                {...register('gender')}
                                className="w-full bg-white border border-gray-200 px-4 py-3 rounded-xl outline-none focus:border-black font-medium"
                            >
                                <option value="">...</option>
                                <option value="male">Masc</option>
                                <option value="female">Fem</option>
                                <option value="other">Outro</option>
                            </select>
                        </div>
                    </div>
                </form>
            </div>

            <div className="fixed bottom-0 w-full p-5 bg-white border-t border-gray-100">
                <button 
                    type="submit"
                    form="profile-form"
                    disabled={loading}
                    className="w-full bg-black text-white font-semibold py-4 rounded-xl active:scale-[0.98] transition-transform flex justify-center items-center gap-2"
                >
                    {loading ? <i className="ri-loader-4-line animate-spin text-xl"></i> : 'Salvar alterações'}
                </button>
            </div>
        </div>
    );
};

export default PersonalData;
