import React, { useContext, useEffect, useState } from 'react';
import { getAccessToken } from '@/services/session';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import axios from 'axios';
import { UserDataContext } from '@/contexts/UserContext';
import { useToast } from '@/contexts/ToastContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import Button from '@/shared/components/ui/Button';
import { getFriendlyErrorMessage } from '@/services/errorMessages';

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
    const [photoUploading, setPhotoUploading] = useState(false);
    const [initialLoading, setInitialLoading] = useState(true);
    const [photoPreview, setPhotoPreview] = useState(user?.profilePicture || user?.photo || null);

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
                    headers: { Authorization: `Bearer ${getAccessToken('user')}` }
                });
                
                // GET /users/profile devolve o user no topo (não em .user).
                const profileData = response.data?.user || response.data || user;

                if (profileData?._id) {
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
                if(profileData?.profilePicture || profileData?.photo) setPhotoPreview(profileData.profilePicture || profileData.photo);
            } catch (error) {
                console.warn('Não foi possível carregar o perfil; usando dados locais.', error);
            } finally {
                setInitialLoading(false);
            }
        };
        fetchProfile();
    }, []);

    const onSubmit = async (data) => {
        setLoading(true);
        try {
            const response = await axios.put(`${import.meta.env.VITE_BASE_URL}/users/profile`, {
                firstname: data.firstname,
                lastname: data.lastname,
                phone: data.phone,
                cpf: data.cpf,
                birthDate: data.birthDate || undefined,
                gender: data.gender || undefined,
            }, {
                headers: { Authorization: `Bearer ${getAccessToken('user')}` }
            });
            const updated = response.data?.user || response.data;
            if (updated) setUser(updated);
            addToast('Perfil atualizado com sucesso!', 'success');
        } catch (error) {
            addToast(
                getFriendlyErrorMessage(error, 'Não foi possível salvar seus dados. Tente novamente.'),
                'error'
            );
        } finally {
            setLoading(false);
        }
    };

    const handlePhotoChange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            addToast('Selecione uma imagem válida.', 'error');
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            addToast('A foto deve ter no máximo 5 MB.', 'error');
            return;
        }

        const localPreview = URL.createObjectURL(file);
        setPhotoPreview(localPreview);
        setPhotoUploading(true);

        try {
            const formData = new FormData();
            formData.append('image', file);
            const response = await axios.post(
                `${import.meta.env.VITE_BASE_URL}/uploads/profile`,
                formData,
                {
                    headers: {
                        Authorization: `Bearer ${getAccessToken('user')}`,
                        'Content-Type': 'multipart/form-data',
                    },
                }
            );
            const url = response.data?.url;
            const updatedUser = response.data?.user;
            if (updatedUser) setUser(updatedUser);
            if (url) setPhotoPreview(url);
            addToast('Foto de perfil atualizada!', 'success');
        } catch (error) {
            setPhotoPreview(user?.profilePicture || user?.photo || null);
            addToast(
                getFriendlyErrorMessage(error, 'Não foi possível enviar a foto. Tente novamente.'),
                'error'
            );
        } finally {
            setPhotoUploading(false);
            URL.revokeObjectURL(localPreview);
            e.target.value = '';
        }
    };

    if (initialLoading) {
        return (
            <div className="h-screen flex items-center justify-center bg-surface-alt">
                <i className="ri-loader-4-line text-4xl animate-spin text-ink-400" aria-hidden="true"></i>
            </div>
        );
    }

    return (
        <div className="h-screen bg-surface-alt flex flex-col font-sans">
            <PageHeader title="Dados Pessoais" onBack={() => navigate('/profile')} />

            <div className="flex-1 overflow-y-auto p-5 pb-24">
                <div className="flex flex-col items-center justify-center mb-8">
                    <div className="relative mb-3">
                        <div className="h-28 w-28 bg-surface-alt rounded-full flex items-center justify-center overflow-hidden border-4 border-surface shadow-raised">
                            {photoPreview ? (
                                <img src={photoPreview} alt="Profile" className="w-full h-full object-cover" loading="lazy" />
                            ) : (
                                <i className="ri-user-fill text-6xl text-ink-400" aria-hidden="true"></i>
                            )}
                        </div>
                        <label htmlFor="photo-upload" className="absolute bottom-0 right-0 bg-ink-900 text-white rounded-full h-10 w-10 flex items-center justify-center shadow-raised cursor-pointer active:scale-95 transition-transform border-2 border-surface">
                            <i className="ri-camera-fill text-lg" aria-hidden="true"></i>
                        </label>
                        <input
                            id="photo-upload"
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handlePhotoChange}
                            disabled={photoUploading}
                        />
                    </div>
                    <p className="text-sm text-ink-400 font-medium">
                        {photoUploading ? 'Enviando foto...' : 'Trocar foto de perfil'}
                    </p>
                </div>

                <form id="profile-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
                    <div className="flex gap-4">
                        <div className="flex-1">
                            <label className="text-xs font-semibold text-ink-400 ml-1 mb-1 block">Nome</label>
                            <input
                                type="text"
                                {...register('firstname')}
                                className={`w-full bg-surface border ${errors.firstname ? 'border-danger-500' : 'border-line'} px-4 py-3 rounded-panel outline-none focus:border-brand-500 font-medium text-ink-900`}
                            />
                            {errors.firstname && <p className="text-xs text-danger-500 mt-1 ml-1">{errors.firstname.message}</p>}
                        </div>
                        <div className="flex-1">
                            <label className="text-xs font-semibold text-ink-400 ml-1 mb-1 block">Sobrenome</label>
                            <input
                                type="text"
                                {...register('lastname')}
                                className={`w-full bg-surface border ${errors.lastname ? 'border-danger-500' : 'border-line'} px-4 py-3 rounded-panel outline-none focus:border-brand-500 font-medium text-ink-900`}
                            />
                            {errors.lastname && <p className="text-xs text-danger-500 mt-1 ml-1">{errors.lastname.message}</p>}
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-ink-400 ml-1 mb-1 block">E-mail</label>
                        <input
                            type="email"
                            {...register('email')}
                            disabled
                            className="w-full bg-surface-alt border border-transparent text-ink-400 px-4 py-3 rounded-panel outline-none font-medium"
                        />
                        <p className="text-[10px] text-ink-400 ml-1 mt-1">O e-mail não pode ser alterado por segurança.</p>
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-ink-400 ml-1 mb-1 block">Telefone</label>
                        <input
                            type="tel"
                            {...register('phone')}
                            placeholder="(00) 00000-0000"
                            className={`w-full bg-surface border ${errors.phone ? 'border-danger-500' : 'border-line'} px-4 py-3 rounded-panel outline-none focus:border-brand-500 font-medium text-ink-900`}
                        />
                        {errors.phone && <p className="text-xs text-danger-500 mt-1 ml-1">{errors.phone.message}</p>}
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-ink-400 ml-1 mb-1 block">CPF</label>
                        <input
                            type="text"
                            {...register('cpf')}
                            placeholder="000.000.000-00"
                            className={`w-full bg-surface border ${errors.cpf ? 'border-danger-500' : 'border-line'} px-4 py-3 rounded-panel outline-none focus:border-brand-500 font-medium text-ink-900`}
                        />
                        {errors.cpf && <p className="text-xs text-danger-500 mt-1 ml-1">{errors.cpf.message}</p>}
                    </div>

                    <div className="flex gap-4">
                        <div className="flex-[2]">
                            <label className="text-xs font-semibold text-ink-400 ml-1 mb-1 block">Data de Nascimento</label>
                            <input
                                type="date"
                                {...register('birthDate')}
                                className="w-full bg-surface border border-line px-4 py-3 rounded-panel outline-none focus:border-brand-500 font-medium text-ink-900"
                            />
                        </div>
                        <div className="flex-1">
                            <label className="text-xs font-semibold text-ink-400 ml-1 mb-1 block">Gênero</label>
                            <select
                                {...register('gender')}
                                className="w-full bg-surface border border-line px-4 py-3 rounded-panel outline-none focus:border-brand-500 font-medium text-ink-900"
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

            <div className="fixed bottom-0 w-full p-5 bg-surface border-t border-line">
                <Button type="submit" form="profile-form" loading={loading}>
                    Salvar alterações
                </Button>
            </div>
        </div>
    );
};

export default PersonalData;
